/**
 * `/add-template` 人类命令：把自然语言需求交给当前会话的 AI。
 *
 * 宿主约定命令 handler 默认不进入模型；这里用 `agent.followup(...)` 主动塞一条
 * 用户消息，从命令切换到一轮正常对话（做法与 webhook / schedule 插件一致）。
 * AI 拿到提示后会读取仓库分支、和用户确认，再调用 `git_flow_add_template` 保存。
 *
 * 服务端插件保持零运行时依赖，因此这里不 import `@deepseek-ai/dsh-llm`，消息对象
 * 按宿主 `UserMessage` 的结构约定构造。
 *
 * @module dsh-git-flow/command
 */
/**
 * 注册 `/add-template`。
 *
 * @param service 宿主 commands 服务（结构匹配）。
 * @returns 注销函数。
 */
export declare function registerAddTemplateCommand(service: unknown): () => void;
