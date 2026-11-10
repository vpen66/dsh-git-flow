/**
 * 服务端半侧：给工作流面板提供仓库状态、模板存取和单步执行。
 *
 * 面板是会话级的侧边栏标签页，浏览器侧发四类请求：
 * - `POST /git-flow/repo`：读会话工作目录的仓库状态（只读）。
 * - `POST /git-flow/templates` / `/save` / `/delete`：模板的读与改。
 * - `POST /git-flow/step`：执行模板中的一步。
 * - `POST /git-flow/commit`：提交工作区里的改动（提交信息由面板填写）。
 *
 * 仓库路径来自会话自身的 `header.cwd`，不接受请求体传入的任意路径，因此浏览器
 * 侧无法借这个面板操作会话工作目录之外的仓库。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { readRepo, abortMerge, continueMerge, checkoutBranch, fetchRemote, commitWorkspace, type RepoInfo } from './git.js'
import { runStep, type StepOutcome } from './workflow.js'
import type { SyncMode } from './git.js'
import { TemplateStore, validateTemplate, type WorkflowStep, type WorkflowTemplate } from './templates.js'
import { registerTemplateTools } from './tools.js'
import { registerAddTemplateCommand } from './command.js'

/** 服务端需要的宿主服务：会话存储用于按 id 反查工作目录。 */
export const inject = ['sessions']

/** 仓库状态路由。 */
export const REPO_PATH = '/git-flow/repo'
/** 模板读取路由。 */
export const TEMPLATES_PATH = '/git-flow/templates'
/** 模板保存路由。 */
export const SAVE_PATH = '/git-flow/templates/save'
/** 模板删除路由。 */
export const DELETE_PATH = '/git-flow/templates/delete'
/** 单步执行路由。 */
export const STEP_PATH = '/git-flow/step'
/** 冲突处理路由：中止或完成进行中的合并。 */
export const CONFLICT_PATH = '/git-flow/merge-conflict'
/** 拉取远端更新的路由。 */
export const FETCH_PATH = '/git-flow/fetch'
/** 提交工作区改动的路由。 */
export const COMMIT_PATH = '/git-flow/commit'
/** 切回指定分支的路由。 */
export const CHECKOUT_PATH = '/git-flow/checkout'
/** 恢复内置默认模板路由。 */
export const RESTORE_PATH = '/git-flow/templates/restore-default'

/** 请求体上限；面板的请求都是小 JSON。 */
const MAX_BODY_BYTES = 256 * 1024

/** 宿主的 web 路由表；类型在本地声明以保持插件零依赖。 */
interface RouteTable {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 宿主的连接可信面；用于拒绝跨站请求。 */
interface RouteConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * 写一个 JSON 响应。
 *
 * @param res 响应对象。
 * @param status HTTP 状态码。
 * @param payload 响应内容。
 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // 状态依赖仓库此刻的内容，不能被缓存。
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 读取有上限的请求体。
 *
 * @param req 请求对象。
 * @returns UTF-8 文本；超出上限时为 null。
 */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 校验请求格式与可信性。
 *
 * @param req 请求对象。
 * @param connection 连接可信面。
 * @param res 响应对象，校验失败时已写入响应。
 * @returns 通过时返回解析后的 JSON 对象；失败时返回 null。
 */
async function admit(
  req: IncomingMessage,
  connection: RouteConnection | undefined,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const rejection = connection?.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return null
  }
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end()
    return null
  }
  const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
  if (essence !== 'application/json') {
    sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
    return null
  }
  let text: string | null
  try {
    text = await readBoundedBody(req)
  } catch {
    sendJson(res, 400, { code: 'bad-request', message: 'request body unreadable' })
    return null
  }
  if (text === null) {
    sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' })
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { code: 'bad-request', message: 'body must be a JSON object' })
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    sendJson(res, 400, { code: 'bad-request', message: 'body must be valid JSON' })
    return null
  }
}

/**
 * 把请求体里的步骤对象收敛成可信形状。
 *
 * @param value 未知值。
 * @returns 步骤对象；形状非法时返回 null。
 */
function parseStep(value: unknown): WorkflowStep | null {
  if (typeof value !== 'object' || value === null) return null
  const step = value as Partial<WorkflowStep>
  if (typeof step.id !== 'string' || step.id === '') return null
  if (step.kind !== 'create' && step.kind !== 'merge' && step.kind !== 'push' && step.kind !== 'tag') return null
  // push 步骤没有来源，其余类型必须有。
  if (step.kind !== 'push' && (typeof step.source !== 'string' || step.source === '')) return null
  if (typeof step.target !== 'string' || step.target === '') return null
  const parsed: WorkflowStep = {
    id: step.id,
    kind: step.kind,
    source: typeof step.source === 'string' ? step.source : '',
    target: step.target,
    push: step.push === true,
  }
  if (typeof step.note === 'string') parsed.note = step.note
  return parsed
}

/**
 * 把变量取值收敛为字符串字典。
 *
 * @param value 未知值。
 * @returns 变量字典；非法时返回空对象。
 */
function parseValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return out
}

/** 会话工作目录缺失时的空仓库状态。 */
const NO_REPO: RepoInfo = {
  isRepo: false,
  root: '',
  current: '',
  inProgress: null,
  dirtyCount: 0,
  untrackedCount: 0,
  conflicts: [],
  branches: [],
  error: '未找到该会话的工作目录',
}

/**
 * 插件入口：注册会话索引、模板存储、十条路由，以及给 AI 用的模板工具与命令。
 *
 * @param ctx 插件上下文。
 */
export function apply(ctx: Context): void {
  const store = new TemplateStore()
  // 会话 id → 工作目录。路由只能操作这些目录，请求体里的路径一律不采信。
  const workspaces = new Map<string, string>()

  // AI 集成：注册模板工具与 `/add-template` 命令。都走嵌套注入并容忍服务缺席——
  // 没有 commands/tools 的 profile（例如 CLI）里，右栏面板照常工作。
  ctx.inject(['tools'], (toolsCtx: Context) => {
    const tools = Reflect.get(toolsCtx, 'tools') as unknown
    if (tools === undefined || tools === null) return
    ctx.effect(() => registerTemplateTools(tools, store), 'git-flow: template tools')
  })

  ctx.inject(['commands'], (commandsCtx: Context) => {
    const commands = Reflect.get(commandsCtx, 'commands') as unknown
    if (commands === undefined || commands === null) return
    ctx.effect(() => registerAddTemplateCommand(commands), 'git-flow: /add-template')
  })

  /**
   * 解析会话的工作目录。
   *
   * 先查事件索引；插件加载之前就已存在的会话不在索引里，再按 id 向会话存储反查。
   *
   * @param sessionId 会话标识。
   * @returns 绝对路径；会话不存在或没有工作目录时返回 undefined。
   */
  const workspaceOf = (sessionId: string): string | undefined => {
    const cached = workspaces.get(sessionId)
    if (cached !== undefined) return cached
    const sessions = Reflect.get(ctx, 'sessions') as { get(id: string): Session | undefined } | undefined
    const session = sessions?.get(sessionId)
    const cwd = session?.header.cwd
    if (cwd === undefined) return undefined
    workspaces.set(sessionId, cwd)
    return cwd
  }

  ctx.on('session/created', (session: Session) => {
    const cwd = session.header.cwd
    if (cwd !== undefined) workspaces.set(String(session.id), cwd)
  })

  ctx.on('session/disposed', (session: Session) => {
    workspaces.delete(String(session.id))
  })

  /**
   * 取请求里的 sessionId 并解析出仓库目录。
   *
   * @param body 请求体。
   * @returns 仓库目录；缺失时返回 undefined。
   */
  const repoOf = (body: Record<string, unknown>): string | undefined => {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    return sessionId === '' ? undefined : workspaceOf(sessionId)
  }

  ctx.inject(['webServer', 'connection'], (routeCtx: Context) => {
    const webServer = Reflect.get(routeCtx, 'webServer') as RouteTable
    const connection = Reflect.get(routeCtx, 'connection') as RouteConnection

    /**
     * 注册一条 POST JSON 路由。
     *
     * @param path 路由路径。
     * @param handle 处理函数；返回要序列化的响应体。
     */
    const route = (path: string, handle: (body: Record<string, unknown>) => Promise<unknown>): void => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          const body = await admit(req, connection, res)
          if (body === null) return
          try {
            sendJson(res, 200, await handle(body))
          } catch (error) {
            sendJson(res, 500, {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }), `git-flow: POST ${path}`)
    }

    // 仓库状态：分支列表、当前分支、脏工作区与进行中的操作。
    route(REPO_PATH, async (body) => {
      const cwd = repoOf(body)
      if (cwd === undefined) return { repo: NO_REPO }
      return { repo: await readRepo(cwd) }
    })

    // 模板读取；首次调用会在磁盘上种入默认模板。
    route(TEMPLATES_PATH, async () => {
      return { templates: await store.load() }
    })

    // 模板保存（新增或覆盖同 id 的模板）。
    route(SAVE_PATH, async (body) => {
      const invalid = validateTemplate(body.template)
      if (invalid !== null) return { templates: await store.load(), error: invalid }
      return { templates: await store.upsert(body.template as WorkflowTemplate) }
    })

    // 模板删除。
    route(DELETE_PATH, async (body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') return { templates: await store.load(), error: '缺少模板 id' }
      return { templates: await store.remove(id) }
    })

    // 拉取远端更新：只 fetch --prune，不动工作区。
    route(FETCH_PATH, async (body) => {
      const cwd = repoOf(body)
      if (cwd === undefined) return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } }
      return { result: await fetchRemote(cwd) }
    })

    // 提交工作区改动：提交说明由面板的输入框传入，只提交到本地、不推送。
    route(COMMIT_PATH, async (body) => {
      const cwd = repoOf(body)
      if (cwd === undefined) return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } }
      const message = typeof body.message === 'string' ? body.message : ''
      return { result: await commitWorkspace(cwd, message) }
    })

    // 执行完把用户送回原来的分支。
    route(CHECKOUT_PATH, async (body) => {
      const cwd = repoOf(body)
      if (cwd === undefined) return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } }
      const branch = typeof body.branch === 'string' ? body.branch : ''
      return { result: await checkoutBranch(cwd, branch) }
    })

    // 把被删掉的内置默认模板加回来。
    route(RESTORE_PATH, async () => {
      const { templates, restored } = await store.ensureDefault()
      return { templates, restored }
    })

    // 处理进行中的合并冲突：中止，或在冲突全部解决后收尾。
    route(CONFLICT_PATH, async (body) => {
      const cwd = repoOf(body)
      if (cwd === undefined) {
        return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } }
      }
      const action = typeof body.action === 'string' ? body.action : ''
      if (action === 'abort') return { result: await abortMerge(cwd) }
      if (action === 'continue') return { result: await continueMerge(cwd) }
      return { result: { ok: false, message: `未知操作：${action}`, output: '' } }
    })

    // 执行一步：由前端按顺序驱动，便于逐步显示状态与失败重试。
    route(STEP_PATH, async (body) => {
      const empty: StepOutcome = {
        stepId: '', kind: 'merge', source: '', target: '', ok: false, skipped: false,
        message: '未找到该会话的工作目录', output: '',
      }
      const cwd = repoOf(body)
      if (cwd === undefined) return { outcome: empty }
      const step = parseStep(body.step)
      if (step === null) return { outcome: { ...empty, message: '步骤定义非法' } }
      // 同步策略由模板带上来；缺省用 merge（分叉时自动合并远端最新）。
      const sync: SyncMode = body.sync === 'ff' || body.sync === 'rebase'
        ? body.sync
        : 'merge'
      return { outcome: await runStep(cwd, step, parseValues(body.values), sync) }
    })
  })
}
