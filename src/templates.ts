/**
 * 工作流指令的类型、默认值与持久化。
 *
 * 一个指令 = 一组变量声明 + 一串有序步骤。步骤里的分支名可以写死，也可以写成
 * `{变量名}` 占位；执行前由用户填变量，运行时再做替换。因此同一套引擎既能表达
 * "从 dev 拉 release 再回流"这种固定流程，也能表达任意自定义的合并链路。
 *
 * 指令存在用户主目录下（`~/.dsh/git-flow/templates.json`），跨仓库共享，不写进
 * 任何项目仓库，避免给业务仓库制造 git 噪音。
 */

import { access, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 变量取值方式：手填分支名，或从仓库现有分支里挑。 */
export type VariableKind = 'input' | 'pick'

/** 从来源变量里截取片段的方式。 */
export type DeriveTake = 'after-slash' | 'last-segment' | 'whole'

/**
 * 变量推导规则：从另一个变量的值里截取片段，加上前缀，得到本变量的自动填充值。
 *
 * 例：`feature` 的值是 `feature/v1.0.1`，规则为
 * `{ from: 'feature', take: 'after-slash', prefix: 'release/' }`，
 * 则本变量推导为 `release/v1.0.1`。
 */
export interface VariableDerive {
  /** 来源变量的 key。 */
  from: string
  /** 截取方式，默认 after-slash：取第一个 `/` 之后的部分。 */
  take?: DeriveTake
  /** 拼在前面的前缀，例如 `release/`。 */
  prefix?: string
}

/** 指令变量声明。 */
export interface TemplateVariable {
  /** 占位名，步骤里写 `{key}` 引用。 */
  key: string
  /** 表单上显示的中文名。 */
  label: string
  /** input 手填，pick 从现有分支里选。 */
  kind: VariableKind
  /** pick 时用于过滤分支的通配符，例如 `feature/*`；省略表示全部。 */
  pattern?: string
  /** 表单默认值；有 derive 时作为来源为空时的兜底。 */
  default?: string
  /** 自动填充规则；来源有值时覆盖默认值。 */
  derive?: VariableDerive
}

/** 步骤种类：建分支、合并、推送、打标签、拉取、提交，或执行另一条已保存的指令。 */
export type StepKind = 'create' | 'merge' | 'push' | 'tag' | 'pull' | 'commit' | 'call'

/** 一个执行步骤。 */
export interface WorkflowStep {
  /** 稳定标识，前端用来记录每一步的状态。 */
  id: string
  kind: StepKind
  /**
   * 建分支时的起点、合并/打标签时的来源分支。允许 `{变量}`；
   * `push` / `pull` / `commit` / `call` 步骤不用它，固定为空串。
   */
  source: string
  /**
   * 建分支/合并的目标分支；`tag` 步骤里表示标签名；`push` 步骤里表示要推送的分支；
   * `pull` 步骤里表示要更新到远端最新的本地分支；`commit` 步骤里表示提交说明，
   * 允许 `{变量}`；`call` 步骤里表示被引用指令的 id。
   */
  target: string
  /** 该步之后是否推送目标分支（`tag` 步骤是推送标签）。 */
  push: boolean
  /** 可选备注，显示在步骤标题旁。 */
  note?: string
}

/** 一个完整的工作流指令。 */
export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  /** 可选分组名，仅用于指令列表/右键菜单归类；空串或省略表示未分组。 */
  group?: string
  /**
   * 本地分支与远端分叉时怎么办：
   * - `merge`（默认）：`git merge origin/x`，留一个合并提交；
   * - `rebase`：`git rebase origin/x`，本地提交重放到远端之上，历史线性；
   * - `ff`：只快进，分叉就停下，由人手动处理。
   */
  sync?: 'ff' | 'merge' | 'rebase'
  variables: TemplateVariable[]
  steps: WorkflowStep[]
  /**
   * 旧版组合字段：v5 会把 compose 迁移成 kind=call 的步骤；新指令不再使用它。
   */
  compose?: string[]
  /**
   * 校验失败的原因。只在读取时由服务端补上：损坏的指令不丢弃、不静默删除，
   * 而是带着原因返回，界面标为「无效」并拒绝执行，用户仍能编辑修复或导出。
   */
  invalid?: string
}

/** 指令文件的磁盘格式。 */
export interface TemplateFile {
  /** 写入时总是当前版本；读取时可能是更旧的版本号。 */
  version: number
  templates: WorkflowTemplate[]
}

/** 指令文件位置。 */
export function templatesPath(): string {
  return join(homedir(), '.dsh', 'git-flow', 'templates.json')
}

/** 备份目录；每次覆盖指令文件前把旧版本留一份。 */
export function backupsDir(): string {
  return join(homedir(), '.dsh', 'git-flow', 'backups')
}

/** 备份保留份数；超出后删最旧的。 */
const BACKUP_KEEP = 20

/**
 * 把当前指令文件复制一份带时间戳的备份。
 *
 * 文件不存在时什么也不做。备份失败不阻断保存——保住数据是好事，但不能因此让
 * 用户连指令都存不了。
 */
export async function backupTemplates(): Promise<void> {
  const source = templatesPath()
  try {
    await access(source)
  } catch {
    return
  }
  try {
    const dir = backupsDir()
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(source, join(dir, `templates-${stamp}.json`))
    const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
    for (const stale of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      await unlink(join(dir, stale))
    }
  } catch {
    // 备份只是保险，失败不阻断主流程。
  }
}

/**
 * 生成一个默认的发布流程指令。
 *
 * 与团队现有的发布习惯一致：从 develop 拉 release，合入 feature，先发预发、
 * 再发生产，最后把 release 回流 develop 与 master。用户可以在此之上改。
 *
 * @returns 默认指令。
 */
export function defaultReleaseTemplate(): WorkflowTemplate {
  return {
    id: 'release-default',
    name: '发布流程（示例）',
    description: '从基础分支拉发布分支，合入功能分支，依次发预发和生产，回流后打版本标签',
    variables: [
      { key: 'base', label: '基础分支', kind: 'pick', pattern: 'develop' },
      { key: 'feature', label: '要合入的功能分支', kind: 'pick', pattern: 'feature/*' },
      {
        key: 'release',
        label: '发布分支',
        kind: 'input',
        default: 'release/',
        // 从 feature/v1.0.1 取 `v1.0.1`，拼成 release/v1.0.1，省一次手填。
        derive: { from: 'feature', take: 'after-slash', prefix: 'release/' },
      },
      {
        key: 'tag',
        label: '版本标签',
        kind: 'input',
        // 从 feature/v1.0.1 取 `v1.0.1` 作为标签名。
        derive: { from: 'feature', take: 'after-slash' },
      },
    ],
    steps: [
      { id: 's1', kind: 'create', source: '{base}', target: '{release}', push: false, note: '拉出发布分支' },
      { id: 's2', kind: 'merge', source: '{feature}', target: '{release}', push: false, note: '功能分支合入发布' },
      { id: 's3', kind: 'merge', source: '{release}', target: 'deploy-pre-default/test', push: true, note: '触发预发' },
      { id: 's4', kind: 'merge', source: '{release}', target: 'deploy-prod-default/test', push: true, note: '触发生产' },
      { id: 's5', kind: 'merge', source: '{release}', target: 'develop', push: true, note: '回流开发主线' },
      { id: 's6', kind: 'merge', source: '{release}', target: 'master', push: true, note: '回流主干' },
      { id: 's7', kind: 'tag', source: '{release}', target: '{tag}', push: true, note: '打版本标签并推送' },
    ],
  }
}

/** 当前指令文件版本；2 起支持变量推导，3 起支持打标签步骤。 */
export const TEMPLATE_FILE_VERSION = 5

/**
 * 计算一个变量的自动填充值。
 *
 * 客户端 `client/client.js` 里有一份等价实现：浏览器半侧无法引用服务端模块，
 * 而表单要在输入时立刻联动，不能每次都请求服务端。两处规则必须保持一致。
 *
 * @param variable 目标变量声明。
 * @param values 当前变量取值。
 * @returns 推导出的字符串；来源为空或没有规则时返回空串。
 */
export function computeDerived(variable: TemplateVariable, values: Record<string, string>): string {
  const rule = variable.derive
  if (rule === undefined) return ''
  const source = values[rule.from]
  // 来源为空：退回默认值，避免用户清空来源时字段残留上一个分支名。
  if (source === undefined || source === '') return variable.default ?? ''
  const take = rule.take ?? 'after-slash'
  let part = source
  if (take === 'after-slash') {
    const cut = source.indexOf('/')
    part = cut === -1 ? source : source.slice(cut + 1)
  } else if (take === 'last-segment') {
    const parts = source.split('/')
    part = parts[parts.length - 1] ?? source
  }
  // 截出来是空的（例如刚输到 `feature/`）：只保留前缀，别把字段清成空白。
  if (part === '') return rule.prefix ?? ''
  return `${rule.prefix ?? ''}${part}`
}

/**
 * 把指令里所有变量的推导值算一遍，用于表单初始值。
 *
 * 支持链式推导（A 由 B 推导、B 由 C 推导），最多回溯变量数量轮。
 *
 * @param variables 变量声明。
 * @param values 初始取值。
 * @returns 补齐推导后的取值。
 */
export function applyDerived(
  variables: TemplateVariable[],
  values: Record<string, string>,
): Record<string, string> {
  const next = { ...values }
  for (let round = 0; round < variables.length; round += 1) {
    let changed = false
    for (const variable of variables) {
      if (variable.derive === undefined) continue
      const derived = computeDerived(variable, next)
      if (next[variable.key] !== derived) {
        next[variable.key] = derived
        changed = true
      }
    }
    if (!changed) break
  }
  return next
}

/**
 * 把旧版本指令文件升级到当前版本。
 *
 * 只给内置的发布指令补上 `release` 的推导规则与打标签步骤；用户自建指令原样保留，
 * 不擅自改动。用户改过内置指令时也只补缺的部分，已有的变量和步骤绝不覆盖。
 *
 * @param templates 读到的指令列表。
 * @param version 原始文件版本。
 * @returns 升级后的指令列表。
 */
export function migrateTemplates(templates: WorkflowTemplate[], version: number): WorkflowTemplate[] {
  if (version >= TEMPLATE_FILE_VERSION) return templates
  return templates.map(template => {
    let next = template
    if (next.id === 'release-default') {
      if (version < 2) {
        const variables = (next.variables ?? []).map(variable => {
          if (variable.key !== 'release' || variable.derive !== undefined) return variable
          return {
            ...variable,
            derive: { from: 'feature', take: 'after-slash' as const, prefix: 'release/' },
          }
        })
        next = { ...next, variables }
      }
      if (version < 3) next = addReleaseTag(next)
      // v4：内置指令从「默认」改叫「示例」；用户改过名字的不动。
      if (version < 4 && next.name === '发布流程（默认）') {
        next = { ...next, name: '发布流程（示例）' }
      }
    }
    // v5：旧版「组合指令」转成普通指令 + 引用步骤；新指令直接用 kind=call 的步骤。
    if (version < 5 && Array.isArray(next.compose)) {
      const migrated = { ...next }
      delete migrated.compose
      migrated.steps = next.compose.map((id, index) => ({
        id: `call-${index + 1}`,
        kind: 'call' as const,
        source: '',
        target: id,
        push: false,
      }))
      next = migrated
    }
    return next
  })
}

/**
 * 给内置发布指令补上打标签的变量与步骤。
 *
 * 只在指令仍然声明 `release` 变量时补：用户可能已把内置指令改成完全不同的流程，
 * 这时塞一个引用 `{release}` 的步骤会让指令校验失败。
 *
 * @param template 内置发布指令。
 * @returns 补好打标签能力的指令。
 */
function addReleaseTag(template: WorkflowTemplate): WorkflowTemplate {
  const variables = template.variables ?? []
  const steps = template.steps ?? []
  if (!variables.some(variable => variable.key === 'release')) return template

  const hasTagVariable = variables.some(variable => variable.key === 'tag')
  const hasTagStep = steps.some(step => step.kind === 'tag')
  if (hasTagVariable && hasTagStep) return template

  // 有 feature 变量时让标签名随它自动推导；被用户改名时退化为手填。
  const tagVariable: TemplateVariable = variables.some(variable => variable.key === 'feature')
    ? { key: 'tag', label: '版本标签', kind: 'input', derive: { from: 'feature', take: 'after-slash' } }
    : { key: 'tag', label: '版本标签', kind: 'input' }

  let stepId = 'tag-release'
  for (let nth = 2; steps.some(step => step.id === stepId); nth += 1) stepId = `tag-release-${nth}`

  return {
    ...template,
    variables: hasTagVariable ? variables : [...variables, tagVariable],
    steps: hasTagStep ? steps : [...steps, {
      id: stepId,
      kind: 'tag',
      source: '{release}',
      target: '{tag}',
      push: true,
      note: '打版本标签并推送',
    }],
  }
}

/**
 * 校验一个指令对象是否可以安全执行。
 *
 * @param value 待校验的未知值。
 * @returns 错误说明；通过时返回 null。
 */
export function validateTemplate(value: unknown): string | null {
  // 必须是全函数：AI 工具和指令文件都会传来不可信结构，这里抛异常会让
  // load() 的兜底 catch 把整个指令文件重写成默认指令。
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '指令必须是对象'
  const template = value as Partial<WorkflowTemplate>
  if (typeof template.id !== 'string' || template.id === '') return '指令缺少 id'
  if (typeof template.name !== 'string' || template.name === '') return '指令缺少名称'
  if (template.group !== undefined && typeof template.group !== 'string') return 'group 必须是字符串'
  if (!Array.isArray(template.steps)) return 'steps 必须是数组'
  if (!Array.isArray(template.variables)) return 'variables 必须是数组'
  const compose = Array.isArray(template.compose) ? template.compose : null
  const composed = compose !== null
  if (compose !== null) {
    if (compose.length === 0) return '组合指令至少要引用一个指令'
    const refs = new Set<string>()
    for (const raw of compose) {
      if (typeof raw !== 'string' || raw === '') return '组合引用的指令 id 非法'
      if (raw === template.id) return '组合指令不能引用自己'
      if (refs.has(raw)) return `组合引用了重复的指令 ${raw}`
      refs.add(raw)
    }
    if (template.steps.length > 0) return '组合指令的步骤由引用的指令展开，不能直接填写步骤'
  } else if (template.steps.length === 0) {
    return '指令至少要有一个步骤'
  }
  if (template.sync !== undefined
    && template.sync !== 'ff' && template.sync !== 'merge' && template.sync !== 'rebase') {
    return 'sync 只能是 ff、merge 或 rebase'
  }

  const declared = new Set<string>()
  for (const raw of template.variables) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '变量必须是对象'
    const variable = raw as Partial<TemplateVariable>
    if (typeof variable.key !== 'string' || variable.key === '') return '变量缺少 key'
    if (declared.has(variable.key)) return `变量 ${variable.key} 重复声明`
    if (typeof variable.label !== 'string' || variable.label === '') return `变量 ${variable.key} 缺少 label`
    if (variable.kind !== 'input' && variable.kind !== 'pick') return `变量 ${variable.key} 的 kind 非法`
    if (variable.pattern !== undefined && typeof variable.pattern !== 'string') {
      return `变量 ${variable.key} 的 pattern 必须是字符串`
    }
    if (variable.default !== undefined && typeof variable.default !== 'string') {
      return `变量 ${variable.key} 的 default 必须是字符串`
    }
    if (variable.derive !== undefined && variable.derive !== null) {
      if (typeof variable.derive !== 'object' || Array.isArray(variable.derive)) {
        return `变量 ${variable.key} 的推导规则非法`
      }
      const rule = variable.derive as Partial<VariableDerive>
      if (typeof rule.from !== 'string' || rule.from === '') {
        return `变量 ${variable.key} 的推导来源非法`
      }
      if (rule.take !== undefined && rule.take !== 'after-slash'
        && rule.take !== 'last-segment' && rule.take !== 'whole') {
        return `变量 ${variable.key} 的推导取值方式非法`
      }
      if (rule.prefix !== undefined && typeof rule.prefix !== 'string') {
        return `变量 ${variable.key} 的推导前缀必须是字符串`
      }
    }
    declared.add(variable.key)
  }
  for (const raw of template.variables) {
    const variable = raw as TemplateVariable
    // derive 允许缺省；显式 null 视为没有规则（手改文件时常见）。
    if (variable.derive === undefined || variable.derive === null) continue
    const rule = variable.derive
    if (rule.from === variable.key) return `变量 ${variable.key} 不能从自己推导`
    if (!declared.has(rule.from)) return `变量 ${variable.key} 的推导来源 ${rule.from} 未声明`
    // 沿推导链走一圈，发现环就拒绝，避免运行期无限取值。
    let cursor: string | undefined = rule.from
    for (let hop = 0; hop < declared.size && cursor !== undefined; hop += 1) {
      if (cursor === variable.key) return `变量 ${variable.key} 的推导存在环`
      const next = template.variables.find(item => (item as TemplateVariable).key === cursor) as TemplateVariable | undefined
      cursor = next?.derive?.from
    }
  }

  if (composed) return null
  const keys = new Set(template.variables.map(variable => (variable as TemplateVariable).key))
  const stepIds = new Set<string>()
  for (const raw of template.steps) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '步骤必须是对象'
    const step = raw as Partial<WorkflowStep>
    if (typeof step.id !== 'string' || step.id === '') return '步骤缺少 id'
    if (stepIds.has(step.id)) return `步骤 id ${step.id} 重复`
    stepIds.add(step.id)
    const kind = step.kind
    if (kind !== 'create' && kind !== 'merge' && kind !== 'push' && kind !== 'tag'
      && kind !== 'pull' && kind !== 'commit' && kind !== 'call') {
      return `步骤 ${step.id} 的 kind 非法`
    }
    if (kind === 'call') {
      if (typeof step.target !== 'string' || step.target === '') {
        return `步骤 ${step.id} 缺少要执行的指令 id`
      }
      if (/\{[A-Za-z0-9_]+\}/.test(step.target)) {
        return `步骤 ${step.id} 的执行指令不能引用变量`
      }
      if (step.push === true) return `步骤 ${step.id} 的执行指令步骤不能勾选推送`
      continue
    }
    // 只有 create / merge / tag 需要来源；push / pull / commit 的来源可以是空串。
    const needsSource = kind === 'create' || kind === 'merge' || kind === 'tag'
    if (needsSource && (typeof step.source !== 'string' || step.source === '')) {
      return `步骤 ${step.id} 缺少 source`
    }
    if (typeof step.target !== 'string' || step.target === '') return `步骤 ${step.id} 缺少 target`
    if (step.push !== undefined && typeof step.push !== 'boolean') {
      return `步骤 ${step.id} 的 push 必须是布尔值`
    }
    if (step.note !== undefined && typeof step.note !== 'string') {
      return `步骤 ${step.id} 的 note 必须是字符串`
    }
    // push / pull / commit 步骤没有来源，只检查目标字段里引用的变量。
    const fields = needsSource ? [step.source ?? '', step.target] : [step.target]
    for (const field of fields) {
      for (const name of placeholdersOf(field)) {
        if (!keys.has(name)) return `步骤 ${step.id} 引用了未声明的变量 {${name}}`
      }
    }
  }
  return null
}

/**
 * 校验指令引用（kind=call 步骤，以及旧版 compose）是否存在、是否成环（保存时用）。
 *
 * @param template 待保存的指令。
 * @param all 保存后会落盘的全部指令（包含这条）。
 * @returns 错误说明；合法时返回 null。
 */
export function validateComposeRefs(
  template: WorkflowTemplate,
  all: WorkflowTemplate[],
): string | null {
  const byId = new Map(all.map(item => [item.id, item]))
  const walk = (item: WorkflowTemplate, path: string[]): string | null => {
    const legacy = Array.isArray(item.compose) ? item.compose : []
    const calls = (item.steps ?? []).filter(step => step.kind === 'call').map(step => step.target)
    for (const id of [...legacy, ...calls]) {
      const child = byId.get(id)
      if (child === undefined) return `引用的指令不存在：${id}`
      if (path.includes(child.id)) return `指令引用存在循环：${[...path, child.id].join(' → ')}`
      const error = walk(child, [...path, child.id])
      if (error !== null) return error
    }
    return null
  }
  return walk(template, [template.id])
}

/**
 * 取出一个字段里引用的全部变量名。
 *
 * @param field 可能是 `{base}` 或 `release/1.0.5` 的字符串。
 * @returns 变量名数组，按出现顺序。
 */
export function placeholdersOf(field: string): string[] {
  const found: string[] = []
  for (const match of field.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    const name = match[1]
    if (name !== undefined && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * 把 `{变量}` 替换成实际值。
 *
 * @param field 指令字段。
 * @param values 变量取值。
 * @returns 替换后的分支名。
 */
export function renderField(field: string, values: Record<string, string>): string {
  return field.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name: string) => values[name] ?? `{${name}}`)
}

/** 指令存储：读、写、初始化。 */
export class TemplateStore {
  /** 串行化指令文件的每一次读-改-写，避免并发保存互相覆盖。 */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * 把一段任务串到队列末尾；前一个任务失败也继续排队。
   *
   * @param task 要执行的任务。
   * @returns 任务结果。
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * 读取全部指令；文件不存在时写入默认指令再返回。
   *
   * @returns 指令列表。
   */
  async load(): Promise<WorkflowTemplate[]> {
    return this.enqueue(() => this.readForWrite())
  }

  /**
   * 读全部指令，并按需写回默认指令或迁移结果。
   *
   * 只在队列任务内部调用：它可能写盘，但不会再次入队，因此不会自锁。
   *
   * @returns 指令列表。
   */
  private async readForWrite(): Promise<WorkflowTemplate[]> {
    try {
      const text = await readFile(templatesPath(), 'utf8')
      const parsed: unknown = JSON.parse(text)
      const file = parsed as Partial<TemplateFile>
      if (Array.isArray(file.templates)) {
        // 坏条目不再直接丢弃：只剩 id 就保留并标记原因，避免下次保存把用户数据
        // 永久抹掉。只有连对象都不是的才跳过。
        // 单条校验必须整体 try/catch：校验器一旦抛异常，外层 catch 会把整个文件
        // 重写成默认指令（AI 工具写进来的坏数据最容易触发）。
        const usable: WorkflowTemplate[] = []
        for (const raw of file.templates) {
          if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
          const template = raw as WorkflowTemplate
          if (typeof template.id !== 'string' || template.id === '') continue
          let invalid: string | null
          try {
            invalid = validateTemplate(template)
          } catch {
            invalid = '指令结构损坏，无法校验'
          }
          if (invalid === null) {
            // 校验通过：清掉历史遗留的 invalid 标记，避免修好之后永远显示"有问题"。
            const clean = { ...template }
            delete clean.invalid
            usable.push(clean)
          } else {
            usable.push({ ...template, invalid })
          }
        }
        const version = typeof file.version === 'number' ? file.version : 1
        if (version >= TEMPLATE_FILE_VERSION) return usable
        // 旧文件升级一次并写回，避免每次读都迁移。
        const upgraded = migrateTemplates(usable, version)
        await this.writeNow(upgraded)
        return upgraded
      }
      return [defaultReleaseTemplate()]
    } catch {
      // 解析失败或读不到文件：种入默认指令；旧文件由 writeNow 里的备份保留。
      const seeded = [defaultReleaseTemplate()]
      await this.writeNow(seeded)
      return seeded
    }
  }

  /**
   * 覆盖写入全部指令。
   *
   * @param templates 指令列表。
   */
  async save(templates: WorkflowTemplate[]): Promise<void> {
    await this.enqueue(() => this.writeNow(templates))
  }

  /**
   * 原子写入指令文件：先写临时文件再 rename。
   *
   * 直接覆盖时若进程崩溃会留下截断 JSON，下一次 load() 只能靠备份找回。
   *
   * @param templates 指令列表。
   */
  private async writeNow(templates: WorkflowTemplate[]): Promise<void> {
    // 覆盖前先留一份，防止误删/误改无回退。
    await backupTemplates()
    const path = templatesPath()
    await mkdir(dirname(path), { recursive: true })
    const file: TemplateFile = { version: TEMPLATE_FILE_VERSION, templates }
    const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await rename(temp, path)
    } catch (error) {
      // 写失败时清掉临时文件，别在用户目录留下垃圾。
      await unlink(temp).catch(() => {})
      throw error
    }
  }

  /**
   * 新增或更新一个指令。
   *
   * @param template 指令对象。
   * @returns 保存后的全部指令。
   */
  async upsert(template: WorkflowTemplate): Promise<WorkflowTemplate[]> {
    return this.enqueue(async () => {
      const templates = await this.readForWrite()
      // invalid 是读取时补的诊断字段，由服务端管理，永远不写回文件。
      const clean = { ...template }
      delete clean.invalid
      const index = templates.findIndex(item => item.id === clean.id)
      if (index === -1) templates.push(clean)
      else templates[index] = clean
      await this.writeNow(templates)
      return templates
    })
  }

  /**
   * 按给定的 id 顺序重排指令；未提到的指令按原相对顺序排在后面。
   *
   * @param ids 期望的指令 id 顺序（可只传一部分）。
   * @returns 重排后的全部指令。
   */
  async reorder(ids: string[]): Promise<WorkflowTemplate[]> {
    return this.enqueue(async () => {
      const templates = await this.readForWrite()
      const byId = new Map(templates.map(item => [item.id, item]))
      const ordered: WorkflowTemplate[] = []
      const seen = new Set<string>()
      for (const id of ids) {
        const item = byId.get(id)
        if (item === undefined || seen.has(id)) continue
        seen.add(id)
        ordered.push(item)
      }
      for (const item of templates) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        ordered.push(item)
      }
      await this.writeNow(ordered)
      return ordered
    })
  }

  /**
   * 确保内置的默认发布指令存在；已被删除时重新加回来。
   *
   * @returns 恢复后的全部指令，以及这次是否真的补上了。
   */
  async ensureDefault(): Promise<{ templates: WorkflowTemplate[]; restored: boolean }> {
    return this.enqueue(async () => {
      const templates = await this.readForWrite()
      if (templates.some(template => template.id === 'release-default')) {
        return { templates, restored: false }
      }
      const next = [defaultReleaseTemplate(), ...templates]
      await this.writeNow(next)
      return { templates: next, restored: true }
    })
  }

  /**
   * 删除一个指令。
   *
   * @param id 指令 id。
   * @returns 删除后的全部指令。
   */
  async remove(id: string): Promise<WorkflowTemplate[]> {
    return this.enqueue(async () => {
      const templates = (await this.readForWrite()).filter(item => item.id !== id)
      await this.writeNow(templates)
      return templates
    })
  }
}
