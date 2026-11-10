/**
 * 工作流执行：把一个指令步骤按变量取值解析成实际分支名，然后执行。
 *
 * 只提供「执行一步」这一种原语，由前端按顺序驱动。这样界面上每一步都有独立的
 * 状态与结果，某一步失败时前面的成果保留，可以从失败处重试；引擎自身不保存运行
 * 状态，避免服务端与浏览器对"现在到第几步"产生分歧。
 */
import { createBranch, createTag, fetchOrigin, mergeInto, pushBranch, pushTag, syncBranch, pullBranch, commitWorkspace, listChanges } from './git.js';
import { renderField } from './templates.js';
/**
 * 把步骤里的 `{变量}` 替换成实际值。
 *
 * @param step 指令步骤。
 * @param values 变量取值。
 * @returns 解析后的分支名与推送标记。
 */
export function resolveStep(step, values) {
    return {
        kind: step.kind,
        source: renderField(step.source, values),
        target: renderField(step.target, values),
        push: step.push,
    };
}
/**
 * 检查变量是否都填好了，且解析后没有残留占位符。
 *
 * @param step 指令步骤。
 * @param values 变量取值。
 * @returns 错误说明；通过时返回 null。
 */
export function precheckStep(step, values) {
    const resolved = resolveStep(step, values);
    // target 的含义按步骤类型不同，提示文案跟着区分。
    const targetName = resolved.kind === 'tag'
        ? '标签名'
        : resolved.kind === 'commit'
            ? '提交说明'
            : resolved.kind === 'pull'
                ? '要更新的分支'
                : '目标分支';
    if (resolved.target.trim() === '')
        return `${targetName}为空`;
    if (/\{[A-Za-z0-9_]+\}/.test(resolved.target))
        return `${targetName}还有未填的变量：${resolved.target}`;
    if (resolved.kind === 'tag' && /[\s~^:?*\[\\]/.test(resolved.target)) {
        return `标签名不能包含空白或 ~ ^ : ? * [ \\ 等字符：${resolved.target}`;
    }
    // push / pull / commit 只涉及一个字段，没有来源。
    if (resolved.kind === 'push' || resolved.kind === 'pull' || resolved.kind === 'commit')
        return null;
    if (resolved.source.trim() === '')
        return '来源分支为空';
    if (/\{[A-Za-z0-9_]+\}/.test(resolved.source))
        return `来源分支还有未填的变量：${resolved.source}`;
    // 标签名与分支可以重名，只有建分支/合并才需要来源与目标不同。
    if (resolved.source === resolved.target
        && (resolved.kind === 'create' || resolved.kind === 'merge')) {
        return '来源与目标是同一个分支';
    }
    return null;
}
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
export async function runStep(cwd, step, values, syncMode = 'merge') {
    const resolved = resolveStep(step, values);
    const base = {
        stepId: step.id,
        kind: resolved.kind,
        source: resolved.source,
        target: resolved.target,
        ok: false,
        skipped: false,
        message: '',
        output: '',
    };
    const invalid = precheckStep(step, values);
    if (invalid !== null)
        return { ...base, message: invalid };
    /** 汇总一步及其可选推送的结果。 */
    const finish = (result, skipped) => ({
        ...base,
        ok: result.ok,
        skipped,
        message: result.message,
        output: result.output,
        ...(result.conflicts === undefined ? {} : { conflicts: result.conflicts }),
    });
    if (resolved.kind === 'push') {
        // 推送前先同步远端：本地落后就快进，避免 push 被拒；分叉则停下来提示手动处理。
        await fetchOrigin(cwd);
        const sync = await syncBranch(cwd, resolved.target, syncMode);
        if (!sync.ok) {
            return {
                ...base,
                message: sync.message,
                ...(sync.conflicts === undefined ? {} : { conflicts: sync.conflicts }),
            };
        }
        const pushed = await pushBranch(cwd, resolved.target);
        const prefix = sync.status === 'up-to-date' ? '' : `${sync.message}；`;
        return finish({ ...pushed, message: `${prefix}${pushed.message}` }, false);
    }
    if (resolved.kind === 'tag') {
        // 先拉一次远端：分支可能只存在于远端，标签要指向远端最新提交。
        await fetchOrigin(cwd);
        const created = await createTag(cwd, resolved.target, resolved.source);
        const skipped = created.ok && created.message.includes('跳过创建');
        if (!created.ok || !resolved.push)
            return finish(created, skipped);
        const pushed = await pushTag(cwd, resolved.target);
        return {
            ...base,
            ok: pushed.ok,
            skipped,
            message: `${created.message}；${pushed.message}`,
            output: [created.output, pushed.output].filter(Boolean).join('\n'),
        };
    }
    if (resolved.kind === 'create') {
        const created = await createBranch(cwd, resolved.target, resolved.source, syncMode);
        const skipped = created.ok && created.message.includes('跳过创建');
        if (!created.ok || !resolved.push)
            return finish(created, skipped);
        const pushed = await pushBranch(cwd, resolved.target);
        return {
            ...base,
            ok: pushed.ok,
            skipped,
            message: `${created.message}；${pushed.message}`,
            output: [created.output, pushed.output].filter(Boolean).join('\n'),
        };
    }
    if (resolved.kind === 'commit') {
        const changes = await listChanges(cwd);
        if (changes.length === 0) {
            return { ...base, ok: true, skipped: true, message: '工作区没有可提交的改动，跳过提交', output: '' };
        }
        return finish(await commitWorkspace(cwd, resolved.target), false);
    }
    if (resolved.kind === 'pull') {
        const pulled = await pullBranch(cwd, resolved.target, syncMode);
        return finish(pulled, pulled.skipped === true);
    }
    const merged = await mergeInto(cwd, resolved.source, resolved.target, syncMode);
    const skipped = merged.ok && merged.message.includes('跳过合并');
    if (!merged.ok || !resolved.push)
        return finish(merged, skipped);
    const pushed = await pushBranch(cwd, resolved.target);
    return {
        ...base,
        ok: pushed.ok,
        skipped,
        message: `${merged.message}；${pushed.message}`,
        output: [merged.output, pushed.output].filter(Boolean).join('\n'),
    };
}
