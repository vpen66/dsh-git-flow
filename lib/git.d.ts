/**
 * Git 读取与分支操作。
 *
 * 这里只提供与具体流程无关的原语：读仓库状态、列分支、建分支、合并、推送。
 * 「先合谁再合谁」由模板决定，见 `workflow.ts`。所有函数都接收显式的 `cwd`，
 * 自身不持有状态，便于测试。
 */
/** 一次操作的结果；失败不抛异常，便于界面逐条展示。 */
export interface GitResult {
    ok: boolean;
    /** 一步到位的中文摘要。 */
    message: string;
    /** 原始输出；失败时为错误信息。 */
    output: string;
    /** 冲突文件列表；只有合并失败时会带。 */
    conflicts?: string[];
}
/** 分支的简要观察结果。 */
export interface BranchInfo {
    name: string;
    /** 短哈希。 */
    head: string;
    /** 最新提交标题。 */
    subject: string;
    /** 本地未推送的提交数。 */
    ahead: number;
    /** 相对远端落后的提交数。 */
    behind: number;
}
/** 仓库当前状态。 */
export interface RepoInfo {
    isRepo: boolean;
    root: string;
    /** 当前分支；游离 HEAD 时为 'HEAD'。 */
    current: string;
    /** 未完成的合并/变基等操作，正常为 null。 */
    inProgress: string | null;
    /** 已跟踪文件的改动数量，0 表示干净。 */
    dirtyCount: number;
    /** 当前未解决的冲突文件；没有冲突时为空数组。 */
    conflicts: string[];
    branches: BranchInfo[];
    /** 读取失败原因；成功为 null。 */
    error: string | null;
}
/**
 * 本地分支是否存在。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @returns 存在为 true。
 */
export declare function localBranchExists(cwd: string, branch: string): Promise<boolean>;
/**
 * 已跟踪文件是否有改动。有改动时不允许切分支，否则改动会被带到别的分支。
 *
 * @param cwd 仓库目录。
 * @returns 有改动为 true。
 */
export declare function hasTrackedChanges(cwd: string): Promise<boolean>;
/**
 * 读出当前仍未解决的冲突文件。
 *
 * `--diff-filter=U` 只列「未合并」路径，因此已 `git add` 解决的文件不会出现。
 *
 * @param cwd 仓库目录。
 * @returns 冲突文件相对路径；没有冲突时为空数组。
 */
export declare function conflictedFiles(cwd: string): Promise<string[]>;
/**
 * 读取仓库状态与全部分支。只读。
 *
 * @param cwd 会话工作目录。
 * @returns 仓库状态；非仓库时 `isRepo` 为 false。
 */
export declare function readRepo(cwd: string): Promise<RepoInfo>;
/**
 * 从起点分支创建分支；分支已存在时视为跳过而不是失败，便于流程重复执行。
 *
 * @param cwd 仓库目录。
 * @param branch 要创建的分支名。
 * @param base 起点分支。
 * @returns 执行结果。
 */
export declare function createBranch(cwd: string, branch: string, base: string, mode?: SyncMode): Promise<GitResult>;
/**
 * 把源分支合并进目标分支；目标已包含源时跳过。
 *
 * @param cwd 仓库目录。
 * @param source 源分支。
 * @param target 目标分支。
 * @returns 执行结果；冲突时 ok 为 false 并说明如何解决。
 */
export declare function mergeInto(cwd: string, source: string, target: string, mode?: SyncMode): Promise<GitResult>;
/**
 * 推送一个分支到 origin。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @returns 推送结果。
 */
export declare function pushBranch(cwd: string, branch: string): Promise<GitResult>;
/**
 * 中止进行中的合并，把工作区恢复到合并之前。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果。
 */
export declare function abortMerge(cwd: string): Promise<GitResult>;
/**
 * 完成进行中的合并。
 *
 * 要求冲突文件都已解决并暂存：还有未合并路径时直接拒绝，避免把带冲突标记的
 * 文件提交进去。解决后用 `git commit --no-edit` 收尾，不弹编辑器。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果；仍有冲突时带上未解决的文件。
 */
export declare function continueMerge(cwd: string): Promise<GitResult>;
/**
 * 切回指定分支。
 *
 * 用于工作流跑完后把用户送回他原来所在的分支。只在安全时切换：合并/变基未完成、
 * 已跟踪文件有改动、或目标分支已不存在时一律拒绝，避免把工作区带进一个更糟的状态。
 *
 * @param cwd 仓库目录。
 * @param branch 要切回的分支名。
 * @returns 执行结果。
 */
export declare function checkoutBranch(cwd: string, branch: string): Promise<GitResult>;
/** 分支与远端的关系。 */
export interface SyncResult {
    ok: boolean;
    /**
     * up-to-date 已最新；fast-forward 已快进；merged 已合并远端最新；
     * diverged 分叉且未处理；no-remote 无同名远端；missing 本地不存在。
     */
    status: 'up-to-date' | 'fast-forward' | 'merged' | 'rebased' | 'diverged' | 'no-remote' | 'missing';
    /** 展示用说明；已最新时为空串。 */
    message: string;
    /** 自动合并产生冲突时的文件列表。 */
    conflicts?: string[];
}
/**
 * 同步策略：
 * - `ff`：只快进，分叉即失败；
 * - `merge`（默认）：分叉时 `git merge origin/x`，留下合并提交；
 * - `rebase`：分叉时 `git rebase origin/x`，把本地提交重放到远端之上，历史线性。
 */
export type SyncMode = 'ff' | 'merge' | 'rebase';
/**
 * 拉取远端（含清理已删分支），不触碰工作区。
 *
 * @param cwd 仓库目录。
 */
export declare function fetchOrigin(cwd: string): Promise<void>;
/**
 * 把本地分支同步到远端最新。
 *
 * 两种策略：
 * - `ff`：只快进。本地落后就前进，本地领先就不动，分叉则报错留给人处理。
 * - `merge`（默认）：分叉时把远端最新 **merge** 进来（`git merge --no-edit origin/x`），
 *   等效于 `git pull`（非 rebase 模式），会留下一个合并提交。冲突则停在合并中，
 *   交给面板的「继续合并 / 中止合并」。
 *
 * 有意不用 rebase：变基会重写本地提交，若这些提交已经被别人拉取过，历史就分叉了；
 * 这里的选择是"宁可多一个合并提交，也不改写已有提交"。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @param mode 同步策略，默认 ff。
 * @returns 同步结果。
 */
export declare function syncBranch(cwd: string, branch: string, mode?: SyncMode): Promise<SyncResult>;
/**
 * 从 origin 拉取远端更新（含清理已删除的远端分支）。
 *
 * 只做 `fetch --prune`，不动工作区、不改本地分支，因此任何时候都安全。拉取后统计
 * 各本地分支落后远端多少，让调用方能告诉用户"哪些分支有更新"。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果，`updated` 列出落后于远端的分支。
 */
export declare function fetchRemote(cwd: string): Promise<GitResult & {
    updated?: Array<{
        name: string;
        behind: number;
    }>;
}>;
