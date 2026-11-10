/**
 * 工作流执行：把一个模板步骤按变量取值解析成实际分支名，然后执行。
 *
 * 只提供「执行一步」这一种原语，由前端按顺序驱动。这样界面上每一步都有独立的
 * 状态与结果，某一步失败时前面的成果保留，可以从失败处重试；引擎自身不保存运行
 * 状态，避免服务端与浏览器对"现在到第几步"产生分歧。
 */

import { createBranch, fetchOrigin, mergeInto, pushBranch, syncBranch, type GitResult, type SyncMode } from './git.js'
import { renderField, type WorkflowStep } from './templates.js'

/** 一步执行完的结果。 */
export interface StepOutcome {
  /** 对应模板步骤的 id。 */
  stepId: string
  kind: WorkflowStep['kind']
  /** 解析后的来源分支。 */
  source: string
  /** 解析后的目标分支。 */
  target: string
  /** 该步是否成功；已跳过也算成功。 */
  ok: boolean
  /** 已跳过（例如分支已存在、目标已包含来源）。 */
  skipped: boolean
  /** 展示用摘要。 */
  message: string
  /** 原始输出，失败时用于排查。 */
  output: string
  /** 冲突文件列表；只有合并冲突时会带。 */
  conflicts?: string[]
}

/**
 * 把步骤里的 `{变量}` 替换成实际值。
 *
 * @param step 模板步骤。
 * @param values 变量取值。
 * @returns 解析后的分支名与推送标记。
 */
export function resolveStep(step: WorkflowStep, values: Record<string, string>): {
  kind: WorkflowStep['kind']
  source: string
  target: string
  push: boolean
} {
  return {
    kind: step.kind,
    source: renderField(step.source, values),
    target: renderField(step.target, values),
    push: step.push,
  }
}

/**
 * 检查变量是否都填好了，且解析后没有残留占位符。
 *
 * @param step 模板步骤。
 * @param values 变量取值。
 * @returns 错误说明；通过时返回 null。
 */
export function precheckStep(step: WorkflowStep, values: Record<string, string>): string | null {
  const resolved = resolveStep(step, values)
  if (resolved.target.trim() === '') return '目标分支为空'
  if (/\{[A-Za-z0-9_]+\}/.test(resolved.target)) return `目标分支还有未填的变量：${resolved.target}`
  // push 步骤只涉及一个分支，没有来源。
  if (resolved.kind === 'push') return null
  if (resolved.source.trim() === '') return '来源分支为空'
  if (/\{[A-Za-z0-9_]+\}/.test(resolved.source)) return `来源分支还有未填的变量：${resolved.source}`
  if (resolved.source === resolved.target) return '来源与目标是同一个分支'
  return null
}

/**
 * 执行一个工作流步骤。
 *
 * `create` 建分支（已存在则跳过）；`merge` 合并（目标已包含来源则跳过），
 * 需要时再推送目标分支。任何一步都不做 rebase 或冲突自动解决。
 *
 * @param cwd 仓库目录。
 * @param step 模板步骤。
 * @param values 变量取值。
 * @returns 该步的结果。
 */
export async function runStep(
  cwd: string,
  step: WorkflowStep,
  values: Record<string, string>,
  syncMode: SyncMode = 'merge',
): Promise<StepOutcome> {
  const resolved = resolveStep(step, values)
  const base: StepOutcome = {
    stepId: step.id,
    kind: resolved.kind,
    source: resolved.source,
    target: resolved.target,
    ok: false,
    skipped: false,
    message: '',
    output: '',
  }

  const invalid = precheckStep(step, values)
  if (invalid !== null) return { ...base, message: invalid }

  /** 汇总一步及其可选推送的结果。 */
  const finish = (result: GitResult, skipped: boolean): StepOutcome => ({
    ...base,
    ok: result.ok,
    skipped,
    message: result.message,
    output: result.output,
    ...(result.conflicts === undefined ? {} : { conflicts: result.conflicts }),
  })

  if (resolved.kind === 'push') {
    // 推送前先同步远端：本地落后就快进，避免 push 被拒；分叉则停下来提示手动处理。
    await fetchOrigin(cwd)
    const sync = await syncBranch(cwd, resolved.target, syncMode)
    if (!sync.ok) {
      return {
        ...base,
        message: sync.message,
        ...(sync.conflicts === undefined ? {} : { conflicts: sync.conflicts }),
      }
    }
    const pushed = await pushBranch(cwd, resolved.target)
    const prefix = sync.status === 'up-to-date' ? '' : `${sync.message}；`
    return finish({ ...pushed, message: `${prefix}${pushed.message}` }, false)
  }

  if (resolved.kind === 'create') {
    const created = await createBranch(cwd, resolved.target, resolved.source, syncMode)
    const skipped = created.ok && created.message.includes('跳过创建')
    if (!created.ok || !resolved.push) return finish(created, skipped)
    const pushed = await pushBranch(cwd, resolved.target)
    return {
      ...base,
      ok: pushed.ok,
      skipped,
      message: `${created.message}；${pushed.message}`,
      output: [created.output, pushed.output].filter(Boolean).join('\n'),
    }
  }

  const merged = await mergeInto(cwd, resolved.source, resolved.target, syncMode)
  const skipped = merged.ok && merged.message.includes('跳过合并')
  if (!merged.ok || !resolved.push) return finish(merged, skipped)
  const pushed = await pushBranch(cwd, resolved.target)
  return {
    ...base,
    ok: pushed.ok,
    skipped,
    message: `${merged.message}；${pushed.message}`,
    output: [merged.output, pushed.output].filter(Boolean).join('\n'),
  }
}
