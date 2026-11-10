/**
 * 服务端半侧：给工作流面板提供仓库状态、指令存取和单步执行。
 *
 * 面板是会话级的侧边栏标签页，浏览器侧发四类请求：
 * - `POST /git-flow/repo`：读会话工作目录的仓库状态（只读）。
 * - `POST /git-flow/templates` / `/save` / `/delete`：指令的读与改。
 * - `POST /git-flow/step`：执行指令中的一步。
 * - `POST /git-flow/commit`：提交工作区里的改动（提交信息与勾选的文件由面板传入）。
 * - `POST /git-flow/changes`：列出工作区里的改动文件（提交弹层的勾选列表）。
 * - `POST /git-flow/diff`：读取单个改动文件的对比 diff（提交弹层的 diff 预览）。
 * - `POST /git-flow/switch-branch`：切换当前分支（本地没有但远端存在时按需创建）。
 *
 * 仓库路径来自会话自身的 `header.cwd`，不接受请求体传入的任意路径，因此浏览器
 * 侧无法借这个面板操作会话工作目录之外的仓库。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 服务端需要的宿主服务：会话存储用于按 id 反查工作目录。 */
export declare const inject: string[];
/** 仓库状态路由。 */
export declare const REPO_PATH = "/git-flow/repo";
/** 指令读取路由。 */
export declare const TEMPLATES_PATH = "/git-flow/templates";
/** 指令保存路由。 */
export declare const SAVE_PATH = "/git-flow/templates/save";
/** 指令删除路由。 */
export declare const DELETE_PATH = "/git-flow/templates/delete";
/** 单步执行路由。 */
export declare const STEP_PATH = "/git-flow/step";
/** 最近一次步骤执行结果的路由。 */
export declare const LAST_STEP_PATH = "/git-flow/last-step";
/** 清除最近一次步骤结果的路由。 */
export declare const CLEAR_LAST_STEP_PATH = "/git-flow/last-step/clear";
/** 冲突处理路由：中止或完成进行中的合并。 */
export declare const CONFLICT_PATH = "/git-flow/merge-conflict";
/** 拉取远端更新的路由。 */
export declare const FETCH_PATH = "/git-flow/fetch";
/** 提交工作区改动的路由。 */
export declare const COMMIT_PATH = "/git-flow/commit";
/** 改动文件列表的路由。 */
export declare const CHANGES_PATH = "/git-flow/changes";
/** 单文件对比 diff 的路由。 */
export declare const DIFF_PATH = "/git-flow/diff";
/** 切回指定分支的路由。 */
export declare const CHECKOUT_PATH = "/git-flow/checkout";
/** 切换当前分支的路由。 */
export declare const SWITCH_PATH = "/git-flow/switch-branch";
/** 恢复内置默认指令路由。 */
export declare const RESTORE_PATH = "/git-flow/templates/restore-default";
/**
 * 插件入口：注册会话索引、指令存储、十五条路由，以及给 AI 用的指令工具与命令。
 *
 * @param ctx 插件上下文。
 */
export declare function apply(ctx: Context): void;
