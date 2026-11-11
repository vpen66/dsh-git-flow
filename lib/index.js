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
 * - `POST /git-flow/graph`：读取提交图（只读）。
 *
 * 仓库路径来自会话自身的 `header.cwd`，不接受请求体传入的任意路径，因此浏览器
 * 侧无法借这个面板操作会话工作目录之外的仓库。
 */
import { readRepo, abortMerge, continueMerge, checkoutBranch, switchBranch, readCommitGraph, fetchRemote, commitWorkspace, listChanges, readFileDiff, } from './git.js';
import { runStep } from './workflow.js';
import { TemplateStore, validateComposeRefs, validateTemplate, } from './templates.js';
import { registerTemplateTools } from './tools.js';
import { registerAddTemplateCommand } from './command.js';
import { RunStore } from './runs.js';
/** 服务端需要的宿主服务：会话存储用于按 id 反查工作目录。 */
export const inject = ['sessions'];
/** 仓库状态路由。 */
export const REPO_PATH = '/git-flow/repo';
/** 指令读取路由。 */
export const TEMPLATES_PATH = '/git-flow/templates';
/** 指令保存路由。 */
export const SAVE_PATH = '/git-flow/templates/save';
/** 指令删除路由。 */
export const DELETE_PATH = '/git-flow/templates/delete';
/** 单步执行路由。 */
export const STEP_PATH = '/git-flow/step';
/** 最近一次步骤执行结果的路由。 */
export const LAST_STEP_PATH = '/git-flow/last-step';
/** 清除最近一次步骤结果的路由。 */
export const CLEAR_LAST_STEP_PATH = '/git-flow/last-step/clear';
/** 冲突处理路由：中止或完成进行中的合并。 */
export const CONFLICT_PATH = '/git-flow/merge-conflict';
/** 拉取远端更新的路由。 */
export const FETCH_PATH = '/git-flow/fetch';
/** 提交工作区改动的路由。 */
export const COMMIT_PATH = '/git-flow/commit';
/** 改动文件列表的路由。 */
export const CHANGES_PATH = '/git-flow/changes';
/** 单文件对比 diff 的路由。 */
export const DIFF_PATH = '/git-flow/diff';
/** 切回指定分支的路由。 */
export const CHECKOUT_PATH = '/git-flow/checkout';
/** 切换当前分支的路由。 */
export const SWITCH_PATH = '/git-flow/switch-branch';
/** 提交图路由。 */
export const GRAPH_PATH = '/git-flow/graph';
/** 恢复内置默认指令路由。 */
export const RESTORE_PATH = '/git-flow/templates/restore-default';
/** 请求体上限；面板的请求都是小 JSON。 */
const MAX_BODY_BYTES = 256 * 1024;
/** 提交弹层一次最多列出的改动文件数；超出部分不参与勾选，也不会被提交。 */
const MAX_CHANGE_ROWS = 500;
/**
 * 写一个 JSON 响应。
 *
 * @param res 响应对象。
 * @param status HTTP 状态码。
 * @param payload 响应内容。
 */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    // 状态依赖仓库此刻的内容，不能被缓存。
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/**
 * 读取有上限的请求体。
 *
 * @param req 请求对象。
 * @returns UTF-8 文本；超出上限时为 null。
 */
async function readBoundedBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) {
            req.resume();
            return null;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
/**
 * 校验请求格式与可信性。
 *
 * @param req 请求对象。
 * @param connection 连接可信面。
 * @param res 响应对象，校验失败时已写入响应。
 * @returns 通过时返回解析后的 JSON 对象；失败时返回 null。
 */
async function admit(req, connection, res) {
    const rejection = connection?.requestRejection(req);
    if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end();
        return null;
    }
    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('allow', 'POST');
        res.end();
        return null;
    }
    const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase();
    if (essence !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' });
        return null;
    }
    let text;
    try {
        text = await readBoundedBody(req);
    }
    catch {
        sendJson(res, 400, { code: 'bad-request', message: 'request body unreadable' });
        return null;
    }
    if (text === null) {
        sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' });
        return null;
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            sendJson(res, 400, { code: 'bad-request', message: 'body must be a JSON object' });
            return null;
        }
        return parsed;
    }
    catch {
        sendJson(res, 400, { code: 'bad-request', message: 'body must be valid JSON' });
        return null;
    }
}
/**
 * 把请求体里的步骤对象收敛成可信形状。
 *
 * @param value 未知值。
 * @returns 步骤对象；形状非法时返回 null。
 */
function parseStep(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const step = value;
    if (typeof step.id !== 'string' || step.id === '')
        return null;
    if (step.kind !== 'create' && step.kind !== 'merge' && step.kind !== 'push' && step.kind !== 'tag'
        && step.kind !== 'pull' && step.kind !== 'commit')
        return null;
    // 只有 create / merge / tag 需要来源；push / pull / commit 的 source 可以是空串。
    const needsSource = step.kind === 'create' || step.kind === 'merge' || step.kind === 'tag';
    if (needsSource && (typeof step.source !== 'string' || step.source === ''))
        return null;
    if (typeof step.target !== 'string' || step.target === '')
        return null;
    const parsed = {
        id: step.id,
        kind: step.kind,
        source: typeof step.source === 'string' ? step.source : '',
        target: step.target,
        push: step.push === true,
    };
    if (typeof step.note === 'string')
        parsed.note = step.note;
    return parsed;
}
/**
 * 把变量取值收敛为字符串字典。
 *
 * @param value 未知值。
 * @returns 变量字典；非法时返回空对象。
 */
function parseValues(value) {
    const out = {};
    if (typeof value !== 'object' || value === null)
        return out;
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === 'string')
            out[key] = raw;
    }
    return out;
}
/** 会话工作目录缺失时的空仓库状态。 */
const NO_REPO = {
    isRepo: false,
    root: '',
    current: '',
    inProgress: null,
    dirtyCount: 0,
    untrackedCount: 0,
    conflicts: [],
    branches: [],
    remoteBranches: [],
    error: '未找到该会话的工作目录',
};
/**
 * 插件入口：注册会话索引、指令存储、十六条路由，以及给 AI 用的指令工具与命令。
 *
 * @param ctx 插件上下文。
 */
export function apply(ctx) {
    const store = new TemplateStore();
    const runs = new RunStore();
    // 会话 id → 工作目录。路由只能操作这些目录，请求体里的路径一律不采信。
    const workspaces = new Map();
    // AI 集成：注册指令工具与 `/add-template` 命令。都走嵌套注入并容忍服务缺席——
    // 没有 commands/tools 的 profile（例如 CLI）里，右栏面板照常工作。
    ctx.inject(['tools'], (toolsCtx) => {
        const tools = Reflect.get(toolsCtx, 'tools');
        if (tools === undefined || tools === null)
            return;
        ctx.effect(() => registerTemplateTools(tools, store), 'git-flow: template tools');
    });
    ctx.inject(['commands'], (commandsCtx) => {
        const commands = Reflect.get(commandsCtx, 'commands');
        if (commands === undefined || commands === null)
            return;
        ctx.effect(() => registerAddTemplateCommand(commands), 'git-flow: /add-template');
    });
    /**
     * 解析会话的工作目录。
     *
     * 先查事件索引；插件加载之前就已存在的会话不在索引里，再按 id 向会话存储反查。
     * 宿主还没装载该会话（刚启动、选中的历史会话尚未激活）时，`sessions` 里查不到，
     * 再从持久化的会话头里读工作目录，面板不必等会话在宿主侧就绪就能看到仓库。
     *
     * @param sessionId 会话标识。
     * @returns 绝对路径；会话不存在或没有工作目录时返回 undefined。
     */
    const workspaceOf = async (sessionId) => {
        const cached = workspaces.get(sessionId);
        if (cached !== undefined)
            return cached;
        const sessions = Reflect.get(ctx, 'sessions');
        const cwd = sessions?.get(sessionId)?.header.cwd;
        if (cwd !== undefined) {
            workspaces.set(sessionId, cwd);
            return cwd;
        }
        const persistence = ctx.get('sessionPersistence');
        if (persistence === undefined)
            return undefined;
        try {
            const stored = (await persistence.stat(sessionId))?.header.cwd;
            if (stored === undefined)
                return undefined;
            workspaces.set(sessionId, stored);
            return stored;
        }
        catch {
            // 持久化层读不到（还没有这个会话、正在写入等）就按没有工作目录处理，面板可以重试。
            return undefined;
        }
    };
    ctx.on('session/created', (session) => {
        const cwd = session.header.cwd;
        if (cwd !== undefined)
            workspaces.set(String(session.id), cwd);
    });
    ctx.on('session/disposed', (session) => {
        workspaces.delete(String(session.id));
    });
    /**
     * 取请求里的 sessionId 并解析出仓库目录。
     *
     * @param body 请求体。
     * @returns 仓库目录；缺失时返回 undefined。
     */
    const repoOf = async (body) => {
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        return sessionId === '' ? undefined : await workspaceOf(sessionId);
    };
    ctx.inject(['webServer', 'connection'], (routeCtx) => {
        const webServer = Reflect.get(routeCtx, 'webServer');
        const connection = Reflect.get(routeCtx, 'connection');
        /**
         * 注册一条 POST JSON 路由。
         *
         * @param path 路由路径。
         * @param handle 处理函数；返回要序列化的响应体。
         */
        const route = (path, handle) => {
            ctx.effect(() => webServer.register({
                kind: 'exact',
                path,
                handler: async (req, res) => {
                    const body = await admit(req, connection, res);
                    if (body === null)
                        return;
                    try {
                        sendJson(res, 200, await handle(body));
                    }
                    catch (error) {
                        sendJson(res, 500, {
                            code: 'internal',
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                },
            }), `git-flow: POST ${path}`);
        };
        // 仓库状态：分支列表、当前分支、脏工作区与进行中的操作。
        route(REPO_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { repo: NO_REPO };
            return { repo: await readRepo(cwd) };
        });
        // 指令读取；首次调用会在磁盘上种入默认指令。
        route(TEMPLATES_PATH, async () => {
            return { templates: await store.load() };
        });
        // 指令保存（新增或覆盖同 id 的指令）。
        route(SAVE_PATH, async (body) => {
            const invalid = validateTemplate(body.template);
            if (invalid !== null)
                return { templates: await store.load(), error: invalid };
            const template = body.template;
            const current = await store.load();
            const merged = [...current.filter(item => item.id !== template.id), template];
            const refInvalid = validateComposeRefs(template, merged);
            if (refInvalid !== null)
                return { templates: current, error: refInvalid };
            return { templates: await store.upsert(template) };
        });
        // 指令删除。
        route(DELETE_PATH, async (body) => {
            const id = typeof body.id === 'string' ? body.id : '';
            if (id === '')
                return { templates: await store.load(), error: '缺少指令 id' };
            const current = await store.load();
            const holder = current.find(item => (Array.isArray(item.compose) && item.compose.includes(id))
                || item.steps.some(step => step.kind === 'call' && step.target === id));
            if (holder !== undefined) {
                return { templates: current, error: `指令「${holder.name}」引用了它，先修改那个指令再删除` };
            }
            return { templates: await store.remove(id) };
        });
        // 拉取远端更新：只 fetch --prune，不动工作区。
        route(FETCH_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } };
            return { result: await fetchRemote(cwd) };
        });
        // 改动文件列表：提交弹层用它渲染勾选列表（只读）。
        route(CHANGES_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { files: [], truncated: false };
            const files = await listChanges(cwd);
            return { files: files.slice(0, MAX_CHANGE_ROWS), truncated: files.length > MAX_CHANGE_ROWS };
        });
        // 单文件 diff：提交弹层里点某个文件的「diff」查看改动（只读）。
        route(DIFF_PATH, async (body) => {
            const cwd = await repoOf(body);
            const path = typeof body.path === 'string' ? body.path : '';
            if (cwd === undefined)
                return { diff: null, error: '未找到该会话的工作目录' };
            if (path === '')
                return { diff: null, error: '缺少文件路径' };
            return await readFileDiff(cwd, path);
        });
        // 提交工作区改动：提交说明与勾选的文件由面板传入，只提交到本地、不推送。
        route(COMMIT_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } };
            const message = typeof body.message === 'string' ? body.message : '';
            const files = Array.isArray(body.files)
                ? body.files.filter((item) => typeof item === 'string')
                : undefined;
            return { result: await commitWorkspace(cwd, message, files) };
        });
        // 执行完把用户送回原来的分支。
        route(CHECKOUT_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } };
            const branch = typeof body.branch === 'string' ? body.branch : '';
            return { result: await checkoutBranch(cwd, branch) };
        });
        // 切换当前分支：本地没有但远端存在时按需创建本地跟踪分支。
        route(SWITCH_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } };
            const branch = typeof body.branch === 'string' ? body.branch : '';
            return { result: await switchBranch(cwd, branch) };
        });
        // 提交图：只读 `git log --all`，供面板画分叉/合并线。
        route(GRAPH_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined) {
                return { graph: { commits: [], current: '', head: '', hasMore: false, error: '未找到该会话的工作目录' } };
            }
            const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 50;
            const scope = body.scope === 'head' ? 'head' : 'all';
            return { graph: await readCommitGraph(cwd, limit, scope) };
        });
        // 把被删掉的内置默认指令加回来。
        route(RESTORE_PATH, async () => {
            const { templates, restored } = await store.ensureDefault();
            return { templates, restored };
        });
        // 处理进行中的合并冲突：中止，或在冲突全部解决后收尾。
        route(CONFLICT_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined) {
                return { result: { ok: false, message: '未找到该会话的工作目录', output: '' } };
            }
            const action = typeof body.action === 'string' ? body.action : '';
            if (action === 'abort')
                return { result: await abortMerge(cwd) };
            if (action === 'continue')
                return { result: await continueMerge(cwd) };
            return { result: { ok: false, message: `未知操作：${action}`, output: '' } };
        });
        // 执行一步：由前端按顺序驱动，便于逐步显示状态与失败重试。
        route(STEP_PATH, async (body) => {
            const empty = {
                stepId: '', kind: 'merge', source: '', target: '', ok: false, skipped: false,
                message: '未找到该会话的工作目录', output: '',
            };
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { outcome: empty };
            const step = parseStep(body.step);
            if (step === null)
                return { outcome: { ...empty, message: '步骤定义非法' } };
            // 同步策略由指令带上来；缺省用 merge（分叉时自动合并远端最新）。
            const sync = body.sync === 'ff' || body.sync === 'rebase'
                ? body.sync
                : 'merge';
            const outcome = await runStep(cwd, step, parseValues(body.values), sync);
            // 持久化最近一次结果：面板重开或应用重启后仍能看到"上次执行失败"。
            try {
                await runs.record({
                    repoRoot: cwd,
                    ...(typeof body.templateName === 'string' ? { templateName: body.templateName } : {}),
                    ...(typeof body.stepIndex === 'number' ? { stepIndex: body.stepIndex } : {}),
                    stepId: outcome.stepId,
                    kind: outcome.kind,
                    source: outcome.source,
                    target: outcome.target,
                    ok: outcome.ok,
                    skipped: outcome.skipped,
                    message: outcome.message,
                    output: outcome.output,
                    ...(outcome.conflicts === undefined ? {} : { conflicts: outcome.conflicts }),
                });
            }
            catch {
                // 记录失败不影响本次执行结果。
            }
            return { outcome };
        });
        // 最近一次步骤结果：面板打开时读回，用于顶部"上次执行失败"横幅。
        route(LAST_STEP_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { last: null };
            return { last: await runs.read(cwd) };
        });
        // 清除最近一次步骤结果：用户点「忽略」时调用。
        route(CLEAR_LAST_STEP_PATH, async (body) => {
            const cwd = await repoOf(body);
            if (cwd === undefined)
                return { cleared: false };
            await runs.clear(cwd);
            return { cleared: true };
        });
    });
}
