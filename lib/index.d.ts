/**
 * 服务端半侧：给工作流面板提供仓库状态、模板存取和单步执行。
 *
 * 面板是会话级的侧边栏标签页，浏览器侧发四类请求：
 * - `POST /git-flow/repo`：读会话工作目录的仓库状态（只读）。
 * - `POST /git-flow/templates` / `/save` / `/delete`：模板的读与改。
 * - `POST /git-flow/step`：执行模板中的一步。
 *
 * 仓库路径来自会话自身的 `header.cwd`，不接受请求体传入的任意路径，因此浏览器
 * 侧无法借这个面板操作会话工作目录之外的仓库。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 服务端需要的宿主服务：会话存储用于按 id 反查工作目录。 */
export declare const inject: string[];
/** 仓库状态路由。 */
export declare const REPO_PATH = "/git-flow/repo";
/** 模板读取路由。 */
export declare const TEMPLATES_PATH = "/git-flow/templates";
/** 模板保存路由。 */
export declare const SAVE_PATH = "/git-flow/templates/save";
/** 模板删除路由。 */
export declare const DELETE_PATH = "/git-flow/templates/delete";
/** 单步执行路由。 */
export declare const STEP_PATH = "/git-flow/step";
/** 冲突处理路由：中止或完成进行中的合并。 */
export declare const CONFLICT_PATH = "/git-flow/merge-conflict";
/** 拉取远端更新的路由。 */
export declare const FETCH_PATH = "/git-flow/fetch";
/** 切回指定分支的路由。 */
export declare const CHECKOUT_PATH = "/git-flow/checkout";
/** 恢复内置默认模板路由。 */
export declare const RESTORE_PATH = "/git-flow/templates/restore-default";
/**
 * 插件入口：注册会话索引、模板存储、九条路由，以及给 AI 用的模板工具与命令。
 *
 * @param ctx 插件上下文。
 */
export declare function apply(ctx: Context): void;
