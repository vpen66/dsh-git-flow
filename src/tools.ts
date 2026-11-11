/**
 * 暴露给 AI 的指令工具。
 *
 * 服务端半侧是零运行时依赖的插件：这里不 import `@deepseek-ai/dsh-tools`，而是按
 * 宿主 `ctx.tools.register` 的结构约定声明最小类型，避免给 link 安装的插件增加依赖。
 *
 * 写入口径与面板一致：先 `validateTemplate` 校验，再交给 `TemplateStore.upsert`
 * （串行读-改-写 + 原子落盘 + 自动备份），所以 AI 写坏数据不会波及整个指令库。
 *
 * @module dsh-git-flow/tools
 */

import { randomUUID } from 'node:crypto'
import {
  TemplateStore, validateComposeRefs, validateTemplate,
  type TemplateVariable, type VariableDerive, type WorkflowStep, type WorkflowTemplate,
} from './templates.js'

/** 宿主 tools 服务的最小结构。 */
interface ToolsService {
  register(definition: TemplateToolDefinition): () => void
}

/** 工具定义里本插件用到的字段。 */
interface TemplateToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: unknown, exec: ToolRunContext) => Promise<unknown>
}

/** 宿主执行上下文里本插件用到的字段。 */
interface ToolRunContext {
  readonly signal: AbortSignal
  readonly agent?: { readonly session?: { readonly header?: { readonly cwd?: string } } }
}

/** 工具入参：变量声明。 */
interface VariableArgs {
  key?: unknown
  label?: unknown
  kind?: unknown
  pattern?: unknown
  default?: unknown
  derive?: unknown
}

/** 工具入参：步骤声明。 */
interface StepArgs {
  id?: unknown
  kind?: unknown
  source?: unknown
  target?: unknown
  push?: unknown
  note?: unknown
}

/** 工具入参：新增指令。 */
interface AddTemplateArgs {
  id?: unknown
  name?: unknown
  description?: unknown
  group?: unknown
  sync?: unknown
  overwrite?: unknown
  variables?: unknown
  steps?: unknown
}

/** 工具输出：一段给模型看的中文摘要。 */
function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/**
 * 从一个不可信值里取字符串；不合法时返回 undefined。
 *
 * @param value 未知值。
 * @returns 字符串或 undefined。
 */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 规范化变量声明，丢掉多余字段。
 *
 * @param raw 原始变量对象。
 * @returns 变量声明。
 */
function normalizeVariable(raw: VariableArgs): TemplateVariable {
  const key = optionalString(raw.key)?.trim() ?? ''
  const label = optionalString(raw.label)?.trim() ?? ''
  if (key === '') throw new Error('变量缺少 key')
  if (label === '') throw new Error(`变量 ${key} 缺少 label`)
  const kind = raw.kind === 'input' || raw.kind === 'pick' ? raw.kind : undefined
  if (kind === undefined) throw new Error(`变量 ${key} 的 kind 只能是 input 或 pick`)
  const variable: TemplateVariable = { key, label, kind }
  const pattern = optionalString(raw.pattern)
  if (pattern !== undefined && pattern !== '') variable.pattern = pattern
  const fallback = optionalString(raw.default)
  if (fallback !== undefined && fallback !== '') variable.default = fallback
  if (typeof raw.derive === 'object' && raw.derive !== null && !Array.isArray(raw.derive)) {
    const rule = raw.derive as Record<string, unknown>
    const from = optionalString(rule.from)?.trim() ?? ''
    if (from === '') throw new Error(`变量 ${key} 的推导来源非法`)
    const derive: VariableDerive = { from }
    const take = rule.take
    if (take === 'after-slash' || take === 'last-segment' || take === 'whole') derive.take = take
    else if (take !== undefined) throw new Error(`变量 ${key} 的推导取值方式非法`)
    const prefix = optionalString(rule.prefix)
    if (prefix !== undefined) derive.prefix = prefix
    variable.derive = derive
  }
  return variable
}

/**
 * 规范化步骤声明，丢掉多余字段，并给缺失的步骤 id 补一个稳定值。
 *
 * @param raw 原始步骤对象。
 * @param index 步骤下标。
 * @returns 步骤声明。
 */
function normalizeStep(raw: StepArgs, index: number): WorkflowStep {
  const kind = raw.kind
  if (kind !== 'create' && kind !== 'merge' && kind !== 'push' && kind !== 'tag'
    && kind !== 'pull' && kind !== 'commit' && kind !== 'call') {
    throw new Error(`第 ${index + 1} 步的 kind 只能是 create / merge / push / tag / pull / commit / call`)
  }
  const target = optionalString(raw.target)?.trim() ?? ''
  if (target === '') throw new Error(`第 ${index + 1} 步缺少 target`)
  // 只有 create / merge / tag 需要来源；其余类型不采信传上来的值，统一置空。
  const source = kind === 'create' || kind === 'merge' || kind === 'tag'
    ? optionalString(raw.source)?.trim() ?? ''
    : ''
  const id = optionalString(raw.id)?.trim() || `s${index + 1}`
  const step: WorkflowStep = { id, kind, source, target, push: kind === 'call' ? false : raw.push === true }
  const note = optionalString(raw.note)
  if (note !== undefined && note !== '') step.note = note
  return step
}

/**
 * 把工具入参收成指令对象；形状不对时抛带中文说明的错误。
 *
 * @param args 工具入参。
 * @returns 待校验的指令。
 */
function normalizeTemplate(args: AddTemplateArgs): WorkflowTemplate {
  const name = optionalString(args.name)?.trim() ?? ''
  if (name === '') throw new Error('缺少指令名称 name')
  const rawSteps = args.steps
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw new Error('steps 必须是非空数组')
  const rawVariables = args.variables
  if (rawVariables !== undefined && !Array.isArray(rawVariables)) throw new Error('variables 必须是数组')

  const variables = (rawVariables ?? []).map(raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('变量必须是对象')
    return normalizeVariable(raw as VariableArgs)
  })
  const steps = rawSteps.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('步骤必须是对象')
    return normalizeStep(raw as StepArgs, index)
  })

  const id = optionalString(args.id)?.trim()
    || `tpl-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
  const template: WorkflowTemplate = { id, name, variables, steps }
  const description = optionalString(args.description)?.trim()
  if (description !== undefined && description !== '') template.description = description
  const group = optionalString(args.group)?.trim()
  if (group !== undefined && group !== '') template.group = group
  const sync = args.sync
  if (sync === 'ff' || sync === 'merge' || sync === 'rebase') template.sync = sync
  else if (sync !== undefined) throw new Error('sync 只能是 ff / merge / rebase')
  return template
}

/** `git_flow_add_template` 的参数 schema。 */
const ADD_TEMPLATE_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '指令名称，例如「发布流程（示例）」' },
    description: { type: 'string', description: '一句话说明' },
    group: { type: 'string', description: '可选分组名，例如「发布」；省略表示未分组' },
    id: { type: 'string', description: '指令 id；省略时自动生成，覆盖已有指令时必须显式提供' },
    sync: {
      type: 'string',
      enum: ['ff', 'merge', 'rebase'],
      description: '本地分支与远端分叉时的处理方式，默认 merge',
    },
    overwrite: { type: 'boolean', description: 'id 已存在时是否覆盖，默认 false' },
    variables: {
      type: 'array',
      description: '变量声明；步骤里用 {key} 引用',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '占位名，例如 base' },
          label: { type: 'string', description: '表单上显示的中文名' },
          kind: { type: 'string', enum: ['input', 'pick'], description: 'input 手填；pick 从仓库现有分支里选' },
          pattern: { type: 'string', description: 'pick 的过滤通配符，例如 feature/*' },
          default: { type: 'string', description: '默认值' },
          derive: {
            type: 'object',
            description: '自动填充规则：从另一个变量截片段拼成本变量',
            properties: {
              from: { type: 'string', description: '来源变量 key' },
              take: { type: 'string', enum: ['after-slash', 'last-segment', 'whole'], description: '截取方式，默认 after-slash' },
              prefix: { type: 'string', description: '拼在前面的前缀，例如 release/' },
            },
            required: ['from'],
            additionalProperties: false,
          },
        },
        required: ['key', 'label', 'kind'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      description: '有序步骤，至少一步',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '稳定标识，省略时按序号生成' },
          kind: { type: 'string', enum: ['create', 'merge', 'push', 'tag', 'pull', 'commit', 'call'], description: '建分支 / 合并 / 推送 / 打标签 / 拉取 / 提交 / 执行另一条指令' },
          source: { type: 'string', description: 'create 的起点、merge 的来源，或 tag 要打标签的分支；push / pull / commit 不用它，留空；分支名可用 {变量}' },
          target: { type: 'string', description: 'create/merge 的目标分支、tag 的标签名、push 要推送的分支、pull 要更新到远端最新的本地分支、commit 的提交说明（可用 {变量}），或 call 要执行的指令 id' },
          push: { type: 'boolean', description: '该步完成后是否推送目标分支；tag 步骤则是推送标签' },
          note: { type: 'string', description: '步骤备注' },
        },
        required: ['kind', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'steps'],
  additionalProperties: false,
}

/**
 * 注册指令相关工具。
 *
 * @param tools 宿主 tools 服务（结构匹配）。
 * @param store 与面板共享的指令存储。
 * @returns 注销两个工具的函数。
 */
export function registerTemplateTools(tools: unknown, store: TemplateStore): () => void {
  const service = tools as ToolsService
  const disposers: Array<() => void> = []

  disposers.push(service.register({
    name: 'git_flow_add_template',
    description: '新增或更新一个 Git 工作流指令（存到 ~/.dsh/git-flow/templates.json）。'
      + '指令由变量和有序步骤组成，步骤 kind 只能是 create / merge / push / tag / pull / commit，分支名可用 {变量} 占位。'
      + 'tag 步骤在 source 分支的最新提交上打轻量标签，target 是标签名，push 为 true 时同时推送标签。'
      + 'pull 步骤把本地分支更新到远端最新；commit 步骤提交工作区全部改动，target 是提交说明；'
      + 'call 步骤按顺序执行另一条已保存指令，target 是指令 id。'
      + '保存前会自动校验；id 已存在时默认拒绝覆盖。',
    parameters: ADD_TEMPLATE_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(typeof value === 'string' ? value : String(value)),
    },
    execute: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new Error('参数必须是对象')
      }
      const template = normalizeTemplate(args as AddTemplateArgs)
      const invalid = validateTemplate(template)
      if (invalid !== null) throw new Error(`指令校验失败：${invalid}`)

      const overwrite = (args as AddTemplateArgs).overwrite === true
      const existing = await store.load()
      if (!overwrite && existing.some(item => item.id === template.id)) {
        throw new Error(`指令 id「${template.id}」已存在；换一个 id，或显式传 overwrite: true 覆盖`)
      }
      const merged = [...existing.filter(item => item.id !== template.id), template]
      const refInvalid = validateComposeRefs(template, merged)
      if (refInvalid !== null) throw new Error(`指令校验失败：${refInvalid}`)
      await store.upsert(template)
      return `已保存指令「${template.name}」（id: ${template.id}，${template.variables.length} 个变量，${template.steps.length} 个步骤）。`
        + '如果右栏「Git 工作流」面板开着，提醒用户点指令区的刷新按钮或重新打开面板。'
    },
  }))

  disposers.push(service.register({
    name: 'git_flow_list_templates',
    description: '列出当前已保存的全部 Git 工作流指令（id、名称、变量、步骤），步骤 kind 支持 create / merge / push / tag / pull / commit / call（call 执行另一条指令，target 是指令 id），用于新增或修改前先了解现有指令。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(typeof value === 'string' ? value : String(value)),
    },
    execute: async () => {
      const templates = await store.load()
      if (templates.length === 0) return '当前没有任何指令。'
      return templates.map(template => {
        const variables = template.variables.length === 0
          ? '无变量'
          : template.variables.map(variable => `{${variable.key}}(${variable.label}${variable.kind === 'pick' ? '，选分支' : '，手填'})`).join('、')
        const steps = template.steps.map((step, index) => {
          const action = step.kind === 'call'
            ? `执行指令 ${step.target}`
            : step.kind === 'push'
            ? `推送 ${step.target}`
            : step.kind === 'pull'
              ? `拉取 ${step.target}`
              : step.kind === 'commit'
                ? `提交：${step.target}`
                : step.kind === 'create'
                  ? `从 ${step.source} 创建 ${step.target}`
                  : step.kind === 'tag'
                    ? `从 ${step.source} 打标签 ${step.target}`
                    : `${step.source} → ${step.target}`
          const pushed = step.kind === 'tag'
            ? '（推送标签）'
            : step.kind === 'create' || step.kind === 'merge' ? '（推送）' : ''
          return `${index + 1}. ${action}${step.push ? pushed : ''}`
        }).join('；')
        const compose = Array.isArray(template.compose)
          ? `组合：${template.compose.map(id => id).join(' → ') || '（空）'}`
          : `步骤：${steps}`
        const invalid = template.invalid === undefined ? '' : ` [无效：${template.invalid}]`
        const group = template.group ? `【${template.group}】` : ''
        return `- ${group}${template.name}（id: ${template.id}）${invalid}\n  变量：${variables}\n  ${compose}`
      }).join('\n')
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // 注销失败不应阻断其它清理；宿主会随插件一起销毁上下文。
      }
    }
  }
}
