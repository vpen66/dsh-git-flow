/**
 * 工作流模板的类型、默认值与持久化。
 *
 * 一个模板 = 一组变量声明 + 一串有序步骤。步骤里的分支名可以写死，也可以写成
 * `{变量名}` 占位；执行前由用户填变量，运行时再做替换。因此同一套引擎既能表达
 * "从 dev 拉 release 再回流"这种固定流程，也能表达任意自定义的合并链路。
 *
 * 模板存在用户主目录下（`~/.dsh/git-flow/templates.json`），跨仓库共享，不写进
 * 任何项目仓库，避免给业务仓库制造 git 噪音。
 */
import { access, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** 模板文件位置。 */
export function templatesPath() {
    return join(homedir(), '.dsh', 'git-flow', 'templates.json');
}
/** 备份目录；每次覆盖模板文件前把旧版本留一份。 */
export function backupsDir() {
    return join(homedir(), '.dsh', 'git-flow', 'backups');
}
/** 备份保留份数；超出后删最旧的。 */
const BACKUP_KEEP = 20;
/**
 * 把当前模板文件复制一份带时间戳的备份。
 *
 * 文件不存在时什么也不做。备份失败不阻断保存——保住数据是好事，但不能因此让
 * 用户连模板都存不了。
 */
export async function backupTemplates() {
    const source = templatesPath();
    try {
        await access(source);
    }
    catch {
        return;
    }
    try {
        const dir = backupsDir();
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await copyFile(source, join(dir, `templates-${stamp}.json`));
        const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
        for (const stale of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
            await unlink(join(dir, stale));
        }
    }
    catch {
        // 备份只是保险，失败不阻断主流程。
    }
}
/**
 * 生成一个默认的发布流程模板。
 *
 * 与团队现有的发布习惯一致：从 develop 拉 release，合入 feature，先发预发、
 * 再发生产，最后把 release 回流 develop 与 master。用户可以在此之上改。
 *
 * @returns 默认模板。
 */
export function defaultReleaseTemplate() {
    return {
        id: 'release-default',
        name: '发布流程（默认）',
        description: '从基础分支拉发布分支，合入功能分支，依次发预发和生产，回流后打版本标签',
        variables: [
            { key: 'base', label: '基础分支', kind: 'pick', pattern: 'develop' },
            { key: 'feature', label: '要合入的功能分支', kind: 'pick', pattern: 'feature/*' },
            {
                key: 'release',
                label: '发布分支',
                kind: 'input',
                default: 'release/',
                // 从 feature/v1.0.1 取 `v1.0.1`，拼成 release/v1.0.1，省一次手填。
                derive: { from: 'feature', take: 'after-slash', prefix: 'release/' },
            },
            {
                key: 'tag',
                label: '版本标签',
                kind: 'input',
                // 从 feature/v1.0.1 取 `v1.0.1` 作为标签名。
                derive: { from: 'feature', take: 'after-slash' },
            },
        ],
        steps: [
            { id: 's1', kind: 'create', source: '{base}', target: '{release}', push: false, note: '拉出发布分支' },
            { id: 's2', kind: 'merge', source: '{feature}', target: '{release}', push: false, note: '功能分支合入发布' },
            { id: 's3', kind: 'merge', source: '{release}', target: 'deploy-pre-default/test', push: true, note: '触发预发' },
            { id: 's4', kind: 'merge', source: '{release}', target: 'deploy-prod-default/test', push: true, note: '触发生产' },
            { id: 's5', kind: 'merge', source: '{release}', target: 'develop', push: true, note: '回流开发主线' },
            { id: 's6', kind: 'merge', source: '{release}', target: 'master', push: true, note: '回流主干' },
            { id: 's7', kind: 'tag', source: '{release}', target: '{tag}', push: true, note: '打版本标签并推送' },
        ],
    };
}
/** 当前模板文件版本；2 起支持变量推导，3 起支持打标签步骤。 */
export const TEMPLATE_FILE_VERSION = 3;
/**
 * 计算一个变量的自动填充值。
 *
 * 客户端 `client/client.js` 里有一份等价实现：浏览器半侧无法引用服务端模块，
 * 而表单要在输入时立刻联动，不能每次都请求服务端。两处规则必须保持一致。
 *
 * @param variable 目标变量声明。
 * @param values 当前变量取值。
 * @returns 推导出的字符串；来源为空或没有规则时返回空串。
 */
export function computeDerived(variable, values) {
    const rule = variable.derive;
    if (rule === undefined)
        return '';
    const source = values[rule.from];
    // 来源为空：退回默认值，避免用户清空来源时字段残留上一个分支名。
    if (source === undefined || source === '')
        return variable.default ?? '';
    const take = rule.take ?? 'after-slash';
    let part = source;
    if (take === 'after-slash') {
        const cut = source.indexOf('/');
        part = cut === -1 ? source : source.slice(cut + 1);
    }
    else if (take === 'last-segment') {
        const parts = source.split('/');
        part = parts[parts.length - 1] ?? source;
    }
    // 截出来是空的（例如刚输到 `feature/`）：只保留前缀，别把字段清成空白。
    if (part === '')
        return rule.prefix ?? '';
    return `${rule.prefix ?? ''}${part}`;
}
/**
 * 把模板里所有变量的推导值算一遍，用于表单初始值。
 *
 * 支持链式推导（A 由 B 推导、B 由 C 推导），最多回溯变量数量轮。
 *
 * @param variables 变量声明。
 * @param values 初始取值。
 * @returns 补齐推导后的取值。
 */
export function applyDerived(variables, values) {
    const next = { ...values };
    for (let round = 0; round < variables.length; round += 1) {
        let changed = false;
        for (const variable of variables) {
            if (variable.derive === undefined)
                continue;
            const derived = computeDerived(variable, next);
            if (next[variable.key] !== derived) {
                next[variable.key] = derived;
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    return next;
}
/**
 * 把旧版本模板文件升级到当前版本。
 *
 * 只给内置的发布模板补上 `release` 的推导规则与打标签步骤；用户自建模板原样保留，
 * 不擅自改动。用户改过内置模板时也只补缺的部分，已有的变量和步骤绝不覆盖。
 *
 * @param templates 读到的模板列表。
 * @param version 原始文件版本。
 * @returns 升级后的模板列表。
 */
export function migrateTemplates(templates, version) {
    if (version >= TEMPLATE_FILE_VERSION)
        return templates;
    return templates.map(template => {
        if (template.id !== 'release-default')
            return template;
        let next = template;
        if (version < 2) {
            const variables = (next.variables ?? []).map(variable => {
                if (variable.key !== 'release' || variable.derive !== undefined)
                    return variable;
                return {
                    ...variable,
                    derive: { from: 'feature', take: 'after-slash', prefix: 'release/' },
                };
            });
            next = { ...next, variables };
        }
        if (version < 3)
            next = addReleaseTag(next);
        return next;
    });
}
/**
 * 给内置发布模板补上打标签的变量与步骤。
 *
 * 只在模板仍然声明 `release` 变量时补：用户可能已把内置模板改成完全不同的流程，
 * 这时塞一个引用 `{release}` 的步骤会让模板校验失败。
 *
 * @param template 内置发布模板。
 * @returns 补好打标签能力的模板。
 */
function addReleaseTag(template) {
    const variables = template.variables ?? [];
    const steps = template.steps ?? [];
    if (!variables.some(variable => variable.key === 'release'))
        return template;
    const hasTagVariable = variables.some(variable => variable.key === 'tag');
    const hasTagStep = steps.some(step => step.kind === 'tag');
    if (hasTagVariable && hasTagStep)
        return template;
    // 有 feature 变量时让标签名随它自动推导；被用户改名时退化为手填。
    const tagVariable = variables.some(variable => variable.key === 'feature')
        ? { key: 'tag', label: '版本标签', kind: 'input', derive: { from: 'feature', take: 'after-slash' } }
        : { key: 'tag', label: '版本标签', kind: 'input' };
    let stepId = 'tag-release';
    for (let nth = 2; steps.some(step => step.id === stepId); nth += 1)
        stepId = `tag-release-${nth}`;
    return {
        ...template,
        variables: hasTagVariable ? variables : [...variables, tagVariable],
        steps: hasTagStep ? steps : [...steps, {
                id: stepId,
                kind: 'tag',
                source: '{release}',
                target: '{tag}',
                push: true,
                note: '打版本标签并推送',
            }],
    };
}
/**
 * 校验一个模板对象是否可以安全执行。
 *
 * @param value 待校验的未知值。
 * @returns 错误说明；通过时返回 null。
 */
export function validateTemplate(value) {
    // 必须是全函数：AI 工具和模板文件都会传来不可信结构，这里抛异常会让
    // load() 的兜底 catch 把整个模板文件重写成默认模板。
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return '模板必须是对象';
    const template = value;
    if (typeof template.id !== 'string' || template.id === '')
        return '模板缺少 id';
    if (typeof template.name !== 'string' || template.name === '')
        return '模板缺少名称';
    if (!Array.isArray(template.steps) || template.steps.length === 0)
        return '模板至少要有一个步骤';
    if (!Array.isArray(template.variables))
        return 'variables 必须是数组';
    if (template.sync !== undefined
        && template.sync !== 'ff' && template.sync !== 'merge' && template.sync !== 'rebase') {
        return 'sync 只能是 ff、merge 或 rebase';
    }
    const declared = new Set();
    for (const raw of template.variables) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return '变量必须是对象';
        const variable = raw;
        if (typeof variable.key !== 'string' || variable.key === '')
            return '变量缺少 key';
        if (declared.has(variable.key))
            return `变量 ${variable.key} 重复声明`;
        if (typeof variable.label !== 'string' || variable.label === '')
            return `变量 ${variable.key} 缺少 label`;
        if (variable.kind !== 'input' && variable.kind !== 'pick')
            return `变量 ${variable.key} 的 kind 非法`;
        if (variable.pattern !== undefined && typeof variable.pattern !== 'string') {
            return `变量 ${variable.key} 的 pattern 必须是字符串`;
        }
        if (variable.default !== undefined && typeof variable.default !== 'string') {
            return `变量 ${variable.key} 的 default 必须是字符串`;
        }
        if (variable.derive !== undefined && variable.derive !== null) {
            if (typeof variable.derive !== 'object' || Array.isArray(variable.derive)) {
                return `变量 ${variable.key} 的推导规则非法`;
            }
            const rule = variable.derive;
            if (typeof rule.from !== 'string' || rule.from === '') {
                return `变量 ${variable.key} 的推导来源非法`;
            }
            if (rule.take !== undefined && rule.take !== 'after-slash'
                && rule.take !== 'last-segment' && rule.take !== 'whole') {
                return `变量 ${variable.key} 的推导取值方式非法`;
            }
            if (rule.prefix !== undefined && typeof rule.prefix !== 'string') {
                return `变量 ${variable.key} 的推导前缀必须是字符串`;
            }
        }
        declared.add(variable.key);
    }
    for (const raw of template.variables) {
        const variable = raw;
        // derive 允许缺省；显式 null 视为没有规则（手改文件时常见）。
        if (variable.derive === undefined || variable.derive === null)
            continue;
        const rule = variable.derive;
        if (rule.from === variable.key)
            return `变量 ${variable.key} 不能从自己推导`;
        if (!declared.has(rule.from))
            return `变量 ${variable.key} 的推导来源 ${rule.from} 未声明`;
        // 沿推导链走一圈，发现环就拒绝，避免运行期无限取值。
        let cursor = rule.from;
        for (let hop = 0; hop < declared.size && cursor !== undefined; hop += 1) {
            if (cursor === variable.key)
                return `变量 ${variable.key} 的推导存在环`;
            const next = template.variables.find(item => item.key === cursor);
            cursor = next?.derive?.from;
        }
    }
    const keys = new Set(template.variables.map(variable => variable.key));
    const stepIds = new Set();
    for (const raw of template.steps) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return '步骤必须是对象';
        const step = raw;
        if (typeof step.id !== 'string' || step.id === '')
            return '步骤缺少 id';
        if (stepIds.has(step.id))
            return `步骤 id ${step.id} 重复`;
        stepIds.add(step.id);
        const kind = step.kind;
        if (kind !== 'create' && kind !== 'merge' && kind !== 'push' && kind !== 'tag'
            && kind !== 'pull' && kind !== 'commit') {
            return `步骤 ${step.id} 的 kind 非法`;
        }
        // 只有 create / merge / tag 需要来源；push / pull / commit 的来源可以是空串。
        const needsSource = kind === 'create' || kind === 'merge' || kind === 'tag';
        if (needsSource && (typeof step.source !== 'string' || step.source === '')) {
            return `步骤 ${step.id} 缺少 source`;
        }
        if (typeof step.target !== 'string' || step.target === '')
            return `步骤 ${step.id} 缺少 target`;
        if (step.push !== undefined && typeof step.push !== 'boolean') {
            return `步骤 ${step.id} 的 push 必须是布尔值`;
        }
        if (step.note !== undefined && typeof step.note !== 'string') {
            return `步骤 ${step.id} 的 note 必须是字符串`;
        }
        // push / pull / commit 步骤没有来源，只检查目标字段里引用的变量。
        const fields = needsSource ? [step.source ?? '', step.target] : [step.target];
        for (const field of fields) {
            for (const name of placeholdersOf(field)) {
                if (!keys.has(name))
                    return `步骤 ${step.id} 引用了未声明的变量 {${name}}`;
            }
        }
    }
    return null;
}
/**
 * 取出一个字段里引用的全部变量名。
 *
 * @param field 可能是 `{base}` 或 `release/1.0.5` 的字符串。
 * @returns 变量名数组，按出现顺序。
 */
export function placeholdersOf(field) {
    const found = [];
    for (const match of field.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        const name = match[1];
        if (name !== undefined && !found.includes(name))
            found.push(name);
    }
    return found;
}
/**
 * 把 `{变量}` 替换成实际值。
 *
 * @param field 模板字段。
 * @param values 变量取值。
 * @returns 替换后的分支名。
 */
export function renderField(field, values) {
    return field.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name) => values[name] ?? `{${name}}`);
}
/** 模板存储：读、写、初始化。 */
export class TemplateStore {
    /** 串行化模板文件的每一次读-改-写，避免并发保存互相覆盖。 */
    queue = Promise.resolve();
    /**
     * 把一段任务串到队列末尾；前一个任务失败也继续排队。
     *
     * @param task 要执行的任务。
     * @returns 任务结果。
     */
    enqueue(task) {
        const run = this.queue.then(task, task);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    /**
     * 读取全部模板；文件不存在时写入默认模板再返回。
     *
     * @returns 模板列表。
     */
    async load() {
        return this.enqueue(() => this.readForWrite());
    }
    /**
     * 读全部模板，并按需写回默认模板或迁移结果。
     *
     * 只在队列任务内部调用：它可能写盘，但不会再次入队，因此不会自锁。
     *
     * @returns 模板列表。
     */
    async readForWrite() {
        try {
            const text = await readFile(templatesPath(), 'utf8');
            const parsed = JSON.parse(text);
            const file = parsed;
            if (Array.isArray(file.templates)) {
                // 坏条目不再直接丢弃：只剩 id 就保留并标记原因，避免下次保存把用户数据
                // 永久抹掉。只有连对象都不是的才跳过。
                // 单条校验必须整体 try/catch：校验器一旦抛异常，外层 catch 会把整个文件
                // 重写成默认模板（AI 工具写进来的坏数据最容易触发）。
                const usable = [];
                for (const raw of file.templates) {
                    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
                        continue;
                    const template = raw;
                    if (typeof template.id !== 'string' || template.id === '')
                        continue;
                    let invalid;
                    try {
                        invalid = validateTemplate(template);
                    }
                    catch {
                        invalid = '模板结构损坏，无法校验';
                    }
                    if (invalid === null) {
                        // 校验通过：清掉历史遗留的 invalid 标记，避免修好之后永远显示"有问题"。
                        const clean = { ...template };
                        delete clean.invalid;
                        usable.push(clean);
                    }
                    else {
                        usable.push({ ...template, invalid });
                    }
                }
                const version = typeof file.version === 'number' ? file.version : 1;
                if (version >= TEMPLATE_FILE_VERSION)
                    return usable;
                // 旧文件升级一次并写回，避免每次读都迁移。
                const upgraded = migrateTemplates(usable, version);
                await this.writeNow(upgraded);
                return upgraded;
            }
            return [defaultReleaseTemplate()];
        }
        catch {
            // 解析失败或读不到文件：种入默认模板；旧文件由 writeNow 里的备份保留。
            const seeded = [defaultReleaseTemplate()];
            await this.writeNow(seeded);
            return seeded;
        }
    }
    /**
     * 覆盖写入全部模板。
     *
     * @param templates 模板列表。
     */
    async save(templates) {
        await this.enqueue(() => this.writeNow(templates));
    }
    /**
     * 原子写入模板文件：先写临时文件再 rename。
     *
     * 直接覆盖时若进程崩溃会留下截断 JSON，下一次 load() 只能靠备份找回。
     *
     * @param templates 模板列表。
     */
    async writeNow(templates) {
        // 覆盖前先留一份，防止误删/误改无回退。
        await backupTemplates();
        const path = templatesPath();
        await mkdir(dirname(path), { recursive: true });
        const file = { version: TEMPLATE_FILE_VERSION, templates };
        const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
        try {
            await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
            await rename(temp, path);
        }
        catch (error) {
            // 写失败时清掉临时文件，别在用户目录留下垃圾。
            await unlink(temp).catch(() => { });
            throw error;
        }
    }
    /**
     * 新增或更新一个模板。
     *
     * @param template 模板对象。
     * @returns 保存后的全部模板。
     */
    async upsert(template) {
        return this.enqueue(async () => {
            const templates = await this.readForWrite();
            // invalid 是读取时补的诊断字段，由服务端管理，永远不写回文件。
            const clean = { ...template };
            delete clean.invalid;
            const index = templates.findIndex(item => item.id === clean.id);
            if (index === -1)
                templates.push(clean);
            else
                templates[index] = clean;
            await this.writeNow(templates);
            return templates;
        });
    }
    /**
     * 确保内置的默认发布模板存在；已被删除时重新加回来。
     *
     * @returns 恢复后的全部模板，以及这次是否真的补上了。
     */
    async ensureDefault() {
        return this.enqueue(async () => {
            const templates = await this.readForWrite();
            if (templates.some(template => template.id === 'release-default')) {
                return { templates, restored: false };
            }
            const next = [defaultReleaseTemplate(), ...templates];
            await this.writeNow(next);
            return { templates: next, restored: true };
        });
    }
    /**
     * 删除一个模板。
     *
     * @param id 模板 id。
     * @returns 删除后的全部模板。
     */
    async remove(id) {
        return this.enqueue(async () => {
            const templates = (await this.readForWrite()).filter(item => item.id !== id);
            await this.writeNow(templates);
            return templates;
        });
    }
}
