/**
 * 暴露给 AI 的模板工具。
 *
 * 服务端半侧是零运行时依赖的插件：这里不 import `@deepseek-ai/dsh-tools`，而是按
 * 宿主 `ctx.tools.register` 的结构约定声明最小类型，避免给 link 安装的插件增加依赖。
 *
 * 写入口径与面板一致：先 `validateTemplate` 校验，再交给 `TemplateStore.upsert`
 * （串行读-改-写 + 原子落盘 + 自动备份），所以 AI 写坏数据不会波及整个模板库。
 *
 * @module dsh-git-flow/tools
 */
import { TemplateStore } from './templates.js';
/**
 * 注册模板相关工具。
 *
 * @param tools 宿主 tools 服务（结构匹配）。
 * @param store 与面板共享的模板存储。
 * @returns 注销两个工具的函数。
 */
export declare function registerTemplateTools(tools: unknown, store: TemplateStore): () => void;
