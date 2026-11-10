/**
 * 工作流执行：把一个指令步骤按变量取值解析成实际分支名，然后执行。
 *
 * 只提供「执行一步」这一种原语，由前端按顺序驱动。这样界面上每一步都有独立的
 * 状态与结果，某一步失败时前面的成果保留，可以从失败处重试；引擎自身不保存运行
 * 状态，避免服务端与浏览器对"现在到第几步"产生分歧。
 */
import { type SyncMode } from './git.js';
import { type WorkflowStep } from './templates.js';
/** 一步执行完的结果。 */
export interface StepOutcome {
    /** 对应指令步骤的 id。 */
    stepId: string;
    kind: WorkflowStep['kind'];
    /** 解析后的来源分支。 */
    source: string;
    /** 解析后的目标分支。 */
    target: string;
    /** 该步是否成功；已跳过也算成功。 */
    ok: boolean;
    /** 已跳过（例如分支已存在、目标已包含来源）。 */
    skipped: boolean;
    /** 展示用摘要。 */
    message: string;
    /** 原始输出，失败时用于排查。 */
    output: string;
    /** 冲突文件列表；只有合并冲突时会带。 */
    conflicts?: string[];
}
/**
 * 把步骤里的 `{变量}` 替换成实际值。
 *
 * @param step 指令步骤。
 * @param values 变量取值。
 * @returns 解析后的分支名与推送标记。
 */
export declare function resolveStep(step: WorkflowStep, values: Record<string, string>): {
    kind: WorkflowStep['kind'];
    source: string;
    target: string;
    push: boolean;
};
/**
 * 检查变量是否都填好了，且解析后没有残留占位符。
 *
 * @param step 指令步骤。
 * @param values 变量取值。
 * @returns 错误说明；通过时返回 null。
 */
export declare function precheckStep(step: WorkflowStep, values: Record<string, string>): string | null;
/**
 * 执行一个工作流步骤。
 *
 * `create` 建分支（已存在则跳过）；`merge` 合并（目标已包含来源则跳过）；
 * `tag` 在分支最新提交上打轻量标签（标签已存在则跳过）；`pull` 把本地分支更新到
 * 远端最新（已最新或无同名远端分支则跳过）；`commit` 提交工作区全部改动（没有改动
 * 则跳过）。需要时再推送目标分支或标签。任何一步都不做 rebase 或冲突自动解决。
 *
 * @param cwd 仓库目录。
 * @param step 指令步骤。
 * @param values 变量取值。
 * @returns 该步的结果。
 */
export declare function runStep(cwd: string, step: WorkflowStep, values: Record<string, string>, syncMode?: SyncMode): Promise<StepOutcome>;
