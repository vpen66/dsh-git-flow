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
import { randomUUID } from 'node:crypto';
/** 交给 AI 的固定流程说明。 */
const INSTRUCTIONS = [
    '你现在要为用户新增一个 DeepSeek Harness 的 Git 工作流指令。',
    '1. 先用 git 只读命令查看当前仓库的分支与远端（例如 git for-each-ref --format="%(refname:short)" refs/heads 和 git remote -v），不要修改任何分支或工作区。',
    '2. 根据分支命名推断变量（基础分支、功能分支、发布分支等）和步骤顺序；步骤 kind 只能是 create / merge / push / tag / pull / commit（pull 把指定本地分支更新到远端最新，target 是分支名；commit 提交工作区全部改动，target 是提交说明），分支名和提交说明可以用 {变量} 占位，变量之间可以有 derive 自动填充规则。',
    '3. 把整理出的指令摘要（变量、每步做什么、哪些步骤会推送）用中文列给用户，等待确认。',
    '4. 用户确认后必须调用工具 git_flow_add_template 保存；不要直接编辑 ~/.dsh/git-flow/templates.json。',
    '5. 保存成功后提醒用户刷新右栏「Git 工作流」面板。若想了解已有指令，先调用 git_flow_list_templates。',
].join('\n');
/**
 * 构造一条已冻结的用户消息。
 *
 * @param body 消息正文。
 * @returns 符合宿主 `UserMessage` 形状的对象。
 */
function createUserMessage(body) {
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text: body })]),
        source: Object.freeze({ kind: 'user' }),
    });
}
/**
 * 注册 `/add-template`。
 *
 * @param service 宿主 commands 服务（结构匹配）。
 * @returns 注销函数。
 */
export function registerAddTemplateCommand(service) {
    const commands = service;
    return commands.register({
        name: 'add-template',
        description: '让 AI 根据当前仓库分支新增 Git 工作流指令',
        input: { hint: '描述想要的流程，例如：预发指令，feature 合到 deploy-pre-default/test' },
        handler: (invocation) => {
            const agent = invocation.agent;
            if (agent === undefined) {
                return { kind: 'error', text: '当前会话没有可用的 AI 代理，无法开始生成指令' };
            }
            if (invocation.signal?.aborted === true)
                return { kind: 'error', text: '已取消' };
            const requirement = invocation.rawInput.trim() === ''
                ? '用户没有附加说明：先询问用户想要什么样的流程（发布 / 预发 / 热修 / 回流等），再开始读取分支。'
                : `用户需求：${invocation.rawInput.trim()}`;
            try {
                agent.followup(createUserMessage(`【/add-template】${INSTRUCTIONS}\n\n${requirement}`));
            }
            catch (error) {
                return {
                    kind: 'error',
                    text: `无法开始生成指令：${error instanceof Error ? error.message : String(error)}`,
                };
            }
            return {
                kind: 'success',
                text: '已把需求交给 AI：它会先读取当前仓库分支，确认后调用工具保存指令。',
            };
        },
    });
}
