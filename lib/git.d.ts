/**
 * Git 读取与分支操作。
 *
 * 这里只提供与具体流程无关的原语：读仓库状态、列分支、建分支、合并、推送。
 * 「先合谁再合谁」由指令决定，见 `workflow.ts`。所有函数都接收显式的 `cwd`，
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
    /** 已跟踪文件的改动数量，0 表示没有已跟踪改动。 */
    dirtyCount: number;
    /** 未跟踪的条目数量（目录按一条算，不含 .gitignore 忽略的）。 */
    untrackedCount: number;
    /** 当前未解决的冲突文件；没有冲突时为空数组。 */
    conflicts: string[];
    branches: BranchInfo[];
    /** 远端存在但本地没有同名分支的分支名（不含 `origin/` 前缀，已排除 HEAD 符号引用）；切分支时按需创建本地跟踪分支。 */
    remoteBranches: string[];
    /** 读取失败原因；成功为 null。 */
    error: string | null;
}
/**
 * 把常见 git 失败翻译成中文原因与可执行建议。
 *
 * 只做展示：不改变成功与否，原始 stderr 仍完整放在 `GitResult.output` 里。
 *
 * @param output git 的原始错误输出。
 * @returns 说明；没有命中已知模式时返回 null。
 */
export declare function explainGitFailure(output: string): string | null;
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
/** 提交图里的一条提交。 */
export interface GraphCommit {
    /** 完整提交哈希。 */
    hash: string;
    /** 父提交哈希；根提交为空数组，合并提交有多个。 */
    parents: string[];
    /** 作者名。 */
    author: string;
    /** 作者时间（Unix 秒）。 */
    at: number;
    /** 提交标题。 */
    subject: string;
    /** 指向这条提交的引用（`HEAD -> x`、分支、`origin/x`、`tag: x`）。 */
    refs: string[];
}
/** 提交图数据。 */
export interface CommitGraph {
    commits: GraphCommit[];
    /** 当前分支；游离 HEAD 时为 HEAD。 */
    current: string;
    /** HEAD 指向的提交；没有提交时为空串。 */
    head: string;
    /** 本次 limit 之外是否还有更旧的提交（前端据此显示「加载更多」）。 */
    hasMore: boolean;
    /** 读取失败原因；成功为 null。 */
    error: string | null;
}
/**
 * 读取提交图，带上父提交、作者、时间与引用。
 *
 * 范围二选一：
 * - `all`（默认）：本地分支 + 标签 + HEAD，Git 客户端「全部本地分支」的视图，不会漏掉其它分支的提交；
 * - `head`：只取当前 HEAD 的历史，泳道最少。
 *
 * 只读：不 fetch、不切换分支、不改工作区。按 `--date-order` 返回（父提交一定在子提交之后，
 * 整体按提交时间倒序），前端据此画分叉/合并线；只在远端存在的陈旧分支永远不会出现。
 *
 * @param cwd 仓库目录。
 * @param limit 最多返回多少条提交（默认 50，上限 500）。
 * @param scope `head` 只看当前分支；`all` 看全部本地分支 + 标签 + HEAD。
 * @returns 提交图数据；非仓库或读取失败时 error 有值。
 */
export declare function readCommitGraph(cwd: string, limit?: number, scope?: 'head' | 'all'): Promise<CommitGraph>;
/** 工作区里的一处改动。 */
export interface FileChange {
    /** 相对仓库根的路径。 */
    path: string;
    /** M 修改、A 新增、D 删除、? 未跟踪。 */
    status: 'M' | 'A' | 'D' | '?';
    /** 是否已经在暂存区（INDEX 列不是空格或 ?）。 */
    staged: boolean;
}
/**
 * 列出工作区里的改动（含未跟踪的新文件），供面板勾选要提交的文件。只读。
 *
 * `--porcelain -z` 用 NUL 分隔，路径里有空格或换行也不会被拆行。用 `--no-renames`
 * 把重命名显示为「删除 + 新增」两条，按文件勾选时不必再把新旧路径配对。
 *
 * @param cwd 仓库目录（可以是仓库子目录）。
 * @returns 改动列表，顺序与 `git status` 一致；非仓库或读取失败时为空数组。
 */
export declare function listChanges(cwd: string): Promise<FileChange[]>;
/** 单个改动文件的对比结果。 */
export interface FileDiff {
    /** 相对仓库根的路径。 */
    path: string;
    /** 统一 diff 文本；二进制文件或没有内容差异时为空串。 */
    patch: string;
    /** 新增行数。 */
    added: number;
    /** 删除行数。 */
    deleted: number;
    /** 二进制文件没有可展示的文本 diff。 */
    binary: boolean;
    /** diff 行数超过展示上限，patch 只保留前面部分。 */
    truncated: boolean;
}
/** 读取单文件 diff 的结果；失败时 diff 为 null。 */
export interface FileDiffResult {
    diff: FileDiff | null;
    error: string | null;
}
/**
 * 读取一个改动文件的对比 diff。只读。
 *
 * 对比的是「当前工作区」与 HEAD，也就是按文件勾选提交后真正会进入这次提交的内容；
 * 已暂存但后来又改过的工作区内容也会一起体现。未跟踪的新文件按整文件新增处理。
 * 路径必须存在于当前改动列表：这样既不会借接口读取仓库里的任意文件，也保证弹层里
 * 看到的和将要提交的是同一批文件。
 *
 * @param cwd 仓库目录。
 * @param path 相对仓库根的路径。
 * @returns diff 结果；路径不在改动列表、文件读取失败等情况下 error 有值。
 */
export declare function readFileDiff(cwd: string, path: string): Promise<FileDiffResult>;
/**
 * 把工作区里的改动提交到当前分支。
 *
 * 只提交 `files` 里勾选的文件，未勾选的已暂存文件会先退出暂存区，避免"没勾却被提交"；
 * 不传 `files` 时提交全部改动（兼容旧版浏览器半侧）。含未跟踪的新文件，.gitignore
 * 忽略的除外。只提交到本地，不推送。合并/变基进行中时拒绝提交：那种状态应该用面板的
 * 「继续」收尾，避免把半成品合并提交掉。提交说明走 execFile 的直接参数，不经过 shell。
 *
 * @param cwd 仓库目录。
 * @param message 提交说明；首尾空白会被去掉，空说明拒绝提交。
 * @param files 要提交的文件路径；缺省表示工作区里的全部改动。
 * @returns 执行结果。
 */
export declare function commitWorkspace(cwd: string, message: string, files?: string[]): Promise<GitResult>;
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
 * 本地是否已有同名标签。
 *
 * @param cwd 仓库目录。
 * @param tag 标签名。
 * @returns 存在为 true。
 */
export declare function localTagExists(cwd: string, tag: string): Promise<boolean>;
/**
 * 在指定分支的最新提交上打轻量标签；标签已存在时跳过，便于流程重复执行。
 *
 * 只写 refs/tags，不 checkout、不改工作区，所以工作区有改动也能打标签。分支本地
 * 不存在但远端存在时，直接给远端分支上的提交打标签（发布分支有时只在远端）。
 *
 * @param cwd 仓库目录。
 * @param tag 标签名。
 * @param branch 要打标签的分支。
 * @returns 执行结果。
 */
export declare function createTag(cwd: string, tag: string, branch: string): Promise<GitResult>;
/**
 * 推送一个标签到 origin。
 *
 * 用 `refs/tags/` 全名推送：分支与标签可能同名，这样不会被 git 解析成别的引用。
 *
 * @param cwd 仓库目录。
 * @param tag 标签名。
 * @returns 推送结果。
 */
export declare function pushTag(cwd: string, tag: string): Promise<GitResult>;
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
/**
 * 切换到指定分支；本地没有但远端 origin 有该分支时，按需创建本地跟踪分支。
 *
 * 只在安全时切换：合并/变基未完成、已跟踪文件有改动时一律拒绝，避免把工作区
 * 带进更糟的状态。分支名以 `-` 开头时直接拒绝，防止被 git 当成选项。
 *
 * @param cwd 仓库目录（可以是仓库子目录）。
 * @param branch 目标分支名。
 * @returns 执行结果。
 */
export declare function switchBranch(cwd: string, branch: string): Promise<GitResult>;
/**
 * 把一个本地分支更新到远端最新；本地没有但远端有同名分支时先创建跟踪分支。
 *
 * 与 `syncBranch` 的区别：这里负责「准备分支」——先 fetch，按需创建本地跟踪分支，
 * 并允许本地没有同名远端分支（视为跳过）。工作区有改动不阻塞拉取：快进/更新引用
 * 本身可以带着改动完成，只有改动与远端更新冲突、或需要切换/变基时 git 才会拒绝，
 * 那时给出「先提交或 stash」的提示。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @param mode 同步策略，默认 ff。
 * @returns 执行结果；跳过时 `skipped` 为 true。
 */
export declare function pullBranch(cwd: string, branch: string, mode?: SyncMode): Promise<GitResult & {
    skipped?: boolean;
}>;
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
