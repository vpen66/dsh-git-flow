/**
 * 工作流模板的类型、默认值与持久化。
 *
 * 一个模板 = 一组变量声明 + 一串有序步骤。步骤里的分支名可以写死，也可以写成
 * `{变量名}` 占位；执行前由用户填变量，运行时再做替换。因此同一套引擎既能表达
 * "从 dev 拉 release 再回流"这种固定流程，也能表达任意自定义的合并链路。
 *
 * 模板存在用户主目录下（`~/.dsh/git-flow/templates.json`），跨仓库共享，不写进
 * 任何项目仓库，避免给业务仓库制造 git 噪音。
 */

import { access, copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
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

/** 模板变量声明。 */
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

/** 步骤种类：建分支、合并分支，或只把某个分支推到远端。 */
export type StepKind = 'create' | 'merge' | 'push'

/** 一个执行步骤。 */
export interface WorkflowStep {
  /** 稳定标识，前端用来记录每一步的状态。 */
  id: string
  kind: StepKind
  /** 建分支时的起点，或合并时的来源。允许 `{变量}`；`push` 步骤不用它。 */
  source: string
  /** 建分支/合并的目标分支；`push` 步骤里表示要推送的分支。允许 `{变量}`。 */
  target: string
  /** 该步之后是否推送目标分支。 */
  push: boolean
  /** 可选备注，显示在步骤标题旁。 */
  note?: string
}

/** 一个完整的工作流模板。 */
export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
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
   * 校验失败的原因。只在读取时由服务端补上：损坏的模板不丢弃、不静默删除，
   * 而是带着原因返回，界面标为「无效」并拒绝执行，用户仍能编辑修复或导出。
   */
  invalid?: string
}

/** 模板文件的磁盘格式。 */
export interface TemplateFile {
  /** 写入时总是当前版本；读取时可能是更旧的版本号。 */
  version: number
  templates: WorkflowTemplate[]
}

/** 模板文件位置。 */
export function templatesPath(): string {
  return join(homedir(), '.dsh', 'git-flow', 'templates.json')
}

/** 备份目录；每次覆盖模板文件前把旧版本留一份。 */
export function backupsDir(): string {
  return join(homedir(), '.dsh', 'git-flow', 'backups')
}

/** 备份保留份数；超出后删最旧的。 */
const BACKUP_KEEP = 20

/**
 * 把当前模板文件复制一份带时间戳的备份。
 *
 * 文件不存在时什么也不做。备份失败不阻断保存——保住数据是好事，但不能因此让
 * 用户连模板都存不了。
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
 * 生成一个默认的发布流程模板。
 *
 * 与团队现有的发布习惯一致：从 develop 拉 release，合入 feature，先发预发、
 * 再发生产，最后把 release 回流 develop 与 master。用户可以在此之上改。
 *
 * @returns 默认模板。
 */
export function defaultReleaseTemplate(): WorkflowTemplate {
  return {
    id: 'release-default',
    name: '发布流程（默认）',
    description: '从基础分支拉发布分支，合入功能分支，依次发预发和生产，最后回流',
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
    ],
    steps: [
      { id: 's1', kind: 'create', source: '{base}', target: '{release}', push: false, note: '拉出发布分支' },
      { id: 's2', kind: 'merge', source: '{feature}', target: '{release}', push: false, note: '功能分支合入发布' },
      { id: 's3', kind: 'merge', source: '{release}', target: 'deploy-pre-default/test', push: true, note: '触发预发' },
      { id: 's4', kind: 'merge', source: '{release}', target: 'deploy-prod-default/test', push: true, note: '触发生产' },
      { id: 's5', kind: 'merge', source: '{release}', target: 'develop', push: true, note: '回流开发主线' },
      { id: 's6', kind: 'merge', source: '{release}', target: 'master', push: true, note: '回流主干' },
    ],
  }
}

/** 当前模板文件版本；2 起支持变量推导。 */
export const TEMPLATE_FILE_VERSION = 2

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
 * 把模板里所有变量的推导值算一遍，用于表单初始值。
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
 * 把旧版本模板文件升级到当前版本。
 *
 * 只给内置的发布模板补上 `release` 的推导规则；用户自建模板原样保留，不擅自改动。
 *
 * @param templates 读到的模板列表。
 * @param version 原始文件版本。
 * @returns 升级后的模板列表。
 */
export function migrateTemplates(templates: WorkflowTemplate[], version: number): WorkflowTemplate[] {
  if (version >= TEMPLATE_FILE_VERSION) return templates
  return templates.map(template => {
    if (template.id !== 'release-default') return template
    const variables = (template.variables ?? []).map(variable => {
      if (variable.key !== 'release' || variable.derive !== undefined) return variable
      return {
        ...variable,
        derive: { from: 'feature', take: 'after-slash' as const, prefix: 'release/' },
      }
    })
    return { ...template, variables }
  })
}

/**
 * 校验一个模板对象是否可以安全执行。
 *
 * @param value 待校验的未知值。
 * @returns 错误说明；通过时返回 null。
 */
export function validateTemplate(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return '模板必须是对象'
  const template = value as Partial<WorkflowTemplate>
  if (typeof template.id !== 'string' || template.id === '') return '模板缺少 id'
  if (typeof template.name !== 'string' || template.name === '') return '模板缺少名称'
  if (!Array.isArray(template.steps) || template.steps.length === 0) return '模板至少要有一个步骤'
  if (!Array.isArray(template.variables)) return 'variables 必须是数组'
  if (template.sync !== undefined
    && template.sync !== 'ff' && template.sync !== 'merge' && template.sync !== 'rebase') {
    return 'sync 只能是 ff、merge 或 rebase'
  }

  const declared = new Set<string>()
  for (const variable of template.variables) {
    if (typeof variable.key !== 'string' || variable.key === '') return '变量缺少 key'
    if (typeof variable.label !== 'string' || variable.label === '') return `变量 ${variable.key} 缺少 label`
    if (variable.kind !== 'input' && variable.kind !== 'pick') return `变量 ${variable.key} 的 kind 非法`
    declared.add(variable.key)
  }
  for (const variable of template.variables) {
    if (variable.derive === undefined) continue
    const rule = variable.derive
    if (rule.from === variable.key) return `变量 ${variable.key} 不能从自己推导`
    if (!declared.has(rule.from)) return `变量 ${variable.key} 的推导来源 ${rule.from} 未声明`
    if (rule.take !== undefined && rule.take !== 'after-slash'
      && rule.take !== 'last-segment' && rule.take !== 'whole') {
      return `变量 ${variable.key} 的推导取值方式非法`
    }
    // 沿推导链走一圈，发现环就拒绝，避免运行期无限取值。
    let cursor: string | undefined = rule.from
    for (let hop = 0; hop < declared.size && cursor !== undefined; hop += 1) {
      if (cursor === variable.key) return `变量 ${variable.key} 的推导存在环`
      const next: TemplateVariable | undefined = template.variables.find(item => item.key === cursor)
      cursor = next?.derive?.from
    }
  }

  const keys = new Set(template.variables.map(variable => variable.key))
  for (const step of template.steps) {
    if (typeof step.id !== 'string' || step.id === '') return '步骤缺少 id'
    if (step.kind !== 'create' && step.kind !== 'merge' && step.kind !== 'push') {
      return `步骤 ${step.id} 的 kind 非法`
    }
    if (step.kind !== 'push' && (typeof step.source !== 'string' || step.source === '')) {
      return `步骤 ${step.id} 缺少 source`
    }
    if (typeof step.target !== 'string' || step.target === '') return `步骤 ${step.id} 缺少 target`
    // push 步骤没有来源，只检查目标分支里引用的变量。
    const fields = step.kind === 'push' ? [step.target] : [step.source, step.target]
    for (const field of fields) {
      for (const name of placeholdersOf(field)) {
        if (!keys.has(name)) return `步骤 ${step.id} 引用了未声明的变量 {${name}}`
      }
    }
  }
  return null
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
 * @param field 模板字段。
 * @param values 变量取值。
 * @returns 替换后的分支名。
 */
export function renderField(field: string, values: Record<string, string>): string {
  return field.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name: string) => values[name] ?? `{${name}}`)
}

/** 模板存储：读、写、初始化。 */
export class TemplateStore {
  /** 串行化写入，避免并发保存互相覆盖。 */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * 读取全部模板；文件不存在时写入默认模板再返回。
   *
   * @returns 模板列表。
   */
  async load(): Promise<WorkflowTemplate[]> {
    try {
      const text = await readFile(templatesPath(), 'utf8')
      const parsed: unknown = JSON.parse(text)
      const file = parsed as Partial<TemplateFile>
      if (Array.isArray(file.templates)) {
        // 坏条目不再直接丢弃：只剩 id 就保留并标记原因，避免下次保存把用户数据
        // 永久抹掉。只有连对象都不是的才跳过。
        const usable: WorkflowTemplate[] = []
        for (const raw of file.templates) {
          if (typeof raw !== 'object' || raw === null) continue
          const template = raw as WorkflowTemplate
          if (typeof template.id !== 'string' || template.id === '') continue
          const invalid = validateTemplate(template)
          usable.push(invalid === null ? template : { ...template, invalid })
        }
        const version = typeof file.version === 'number' ? file.version : 1
        if (version >= TEMPLATE_FILE_VERSION) return usable
        // 旧文件升级一次并写回，避免每次读都迁移。
        const upgraded = migrateTemplates(usable, version)
        await this.save(upgraded)
        return upgraded
      }
      return [defaultReleaseTemplate()]
    } catch {
      const seeded = [defaultReleaseTemplate()]
      await this.save(seeded)
      return seeded
    }
  }

  /**
   * 覆盖写入全部模板。
   *
   * @param templates 模板列表。
   */
  async save(templates: WorkflowTemplate[]): Promise<void> {
    const run = async (): Promise<void> => {
      // 覆盖前先留一份，防止误删/误改无回退。
      await backupTemplates()
      const path = templatesPath()
      await mkdir(dirname(path), { recursive: true })
      const file: TemplateFile = { version: TEMPLATE_FILE_VERSION, templates }
      await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    }
    this.queue = this.queue.then(run, run)
    await this.queue
  }

  /**
   * 新增或更新一个模板。
   *
   * @param template 模板对象。
   * @returns 保存后的全部模板。
   */
  async upsert(template: WorkflowTemplate): Promise<WorkflowTemplate[]> {
    const templates = await this.load()
    const index = templates.findIndex(item => item.id === template.id)
    if (index === -1) templates.push(template)
    else templates[index] = template
    await this.save(templates)
    return templates
  }

  /**
   * 确保内置的默认发布模板存在；已被删除时重新加回来。
   *
   * @returns 恢复后的全部模板，以及这次是否真的补上了。
   */
  async ensureDefault(): Promise<{ templates: WorkflowTemplate[]; restored: boolean }> {
    const templates = await this.load()
    if (templates.some(template => template.id === 'release-default')) {
      return { templates, restored: false }
    }
    const next = [defaultReleaseTemplate(), ...templates]
    await this.save(next)
    return { templates: next, restored: true }
  }

  /**
   * 删除一个模板。
   *
   * @param id 模板 id。
   * @returns 删除后的全部模板。
   */
  async remove(id: string): Promise<WorkflowTemplate[]> {
    const templates = (await this.load()).filter(item => item.id !== id)
    await this.save(templates)
    return templates
  }
}
