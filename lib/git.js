/**
 * Git 读取与分支操作。
 *
 * 这里只提供与具体流程无关的原语：读仓库状态、列分支、建分支、合并、推送。
 * 「先合谁再合谁」由模板决定，见 `workflow.ts`。所有函数都接收显式的 `cwd`，
 * 自身不持有状态，便于测试。
 */
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const EMPTY_REPO = {
    isRepo: false,
    root: '',
    current: '',
    inProgress: null,
    dirtyCount: 0,
    untrackedCount: 0,
    conflicts: [],
    branches: [],
    error: null,
};
/**
 * 执行一条 git 命令。
 *
 * @param cwd 仓库目录。
 * @param args git 子命令及其参数。
 * @param options `allowFail` 为真时不把非零退出视为异常；`raw` 为真时保留原始输出
 * （`-z` 的 NUL 分隔格式不能 trim，首条记录的状态位可能以空格开头）。
 * @returns 结果对象。
 */
async function git(cwd, args, options = {}) {
    /** 按需保留原始输出，避免 trim 破坏以空格开头或 NUL 分隔的输出。 */
    const shape = (text) => (options.raw === true ? text : text.trim());
    try {
        const { stdout, stderr } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
        const output = shape(stdout || stderr || '');
        return { ok: true, message: output.split('\n')[0] ?? '', output };
    }
    catch (error) {
        const err = error;
        const output = shape(err.stderr || err.stdout || err.message || '');
        if (options.allowFail)
            return { ok: false, message: output.split('\n')[0] ?? '', output };
        throw new Error(output || `git ${args[0]} failed`);
    }
}
/**
 * 本地分支是否存在。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @returns 存在为 true。
 */
export async function localBranchExists(cwd, branch) {
    const res = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
    return res.ok;
}
/**
 * 远端分支是否存在。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名（不含 `origin/`）。
 * @returns 存在为 true。
 */
async function remoteBranchExists(cwd, branch) {
    const res = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { allowFail: true });
    return res.ok;
}
/**
 * 已跟踪文件是否有改动。有改动时不允许切分支，否则改动会被带到别的分支。
 *
 * @param cwd 仓库目录。
 * @returns 有改动为 true。
 */
export async function hasTrackedChanges(cwd) {
    const res = await git(cwd, ['status', '--porcelain', '--untracked-files=no'], { allowFail: true });
    return res.ok && res.output !== '';
}
/**
 * 读出当前仍未解决的冲突文件。
 *
 * `--diff-filter=U` 只列「未合并」路径，因此已 `git add` 解决的文件不会出现。
 *
 * @param cwd 仓库目录。
 * @returns 冲突文件相对路径；没有冲突时为空数组。
 */
export async function conflictedFiles(cwd) {
    const res = await git(cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
    if (!res.ok || res.output === '')
        return [];
    return res.output.split('\n').map(line => line.trim()).filter(Boolean);
}
/**
 * 检测未完成的合并/变基等操作。
 *
 * @param root 仓库根目录。
 * @returns 中文描述；没有进行中的操作时为 null。
 */
async function detectInProgress(root) {
    /**
     * 取 git 目录下的状态文件是否存在。
     *
     * 用文件判断而不是解析 `git status` 的英文提示：提示文案随版本和语言变化，
     * 一旦没匹配上，界面就会误以为"没有进行中的操作"，把冲突横幅和轮询一起关掉。
     *
     * @param name 状态文件名，如 `MERGE_HEAD`。
     * @returns 存在为 true。
     */
    const marker = async (name) => {
        const res = await git(root, ['rev-parse', '--git-path', name], { allowFail: true });
        if (!res.ok || res.output === '')
            return false;
        const path = res.output.startsWith('/') ? res.output : `${root}/${res.output}`;
        return existsSync(path);
    };
    if (await marker('MERGE_HEAD'))
        return '合并未完成';
    if (await marker('rebase-merge') || await marker('rebase-apply'))
        return '变基中';
    if (await marker('CHERRY_PICK_HEAD'))
        return '拣选中';
    if (await marker('REVERT_HEAD'))
        return '回退中';
    return null;
}
/**
 * 读取一个分支的提交信息与远端差距。
 *
 * @param cwd 仓库目录。
 * @param name 分支名。
 * @returns 分支信息。
 */
async function readBranch(cwd, name) {
    const head = (await git(cwd, ['rev-parse', '--short', name])).output;
    const subjectRes = await git(cwd, ['log', '-1', '--format=%s', name], { allowFail: true });
    const subject = subjectRes.ok ? subjectRes.output : '';
    let ahead = 0;
    let behind = 0;
    if (await remoteBranchExists(cwd, name)) {
        const counts = await git(cwd, ['rev-list', '--left-right', '--count', `origin/${name}...${name}`], { allowFail: true });
        if (counts.ok) {
            const parts = counts.output.split(/\s+/).map(n => Number.parseInt(n, 10));
            const behindCount = parts[0] ?? 0;
            const aheadCount = parts[1] ?? 0;
            behind = Number.isFinite(behindCount) ? behindCount : 0;
            ahead = Number.isFinite(aheadCount) ? aheadCount : 0;
        }
    }
    else {
        // 远端没有同名分支：所有提交都算未推送。
        const all = await git(cwd, ['rev-list', '--count', name], { allowFail: true });
        ahead = all.ok ? Number.parseInt(all.output, 10) || 0 : 0;
    }
    return { name, head, subject, ahead, behind };
}
/**
 * 读取仓库状态与全部分支。只读。
 *
 * @param cwd 会话工作目录。
 * @returns 仓库状态；非仓库时 `isRepo` 为 false。
 */
export async function readRepo(cwd) {
    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
    if (!inside.ok || inside.output !== 'true')
        return { ...EMPTY_REPO, root: cwd, error: '当前目录不是 git 仓库' };
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).output;
    const current = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).output;
    const inProgress = await detectInProgress(root);
    // 一次 status 同时得到已跟踪改动与未跟踪条目；未跟踪不阻塞合并，但可以提交。
    // 用默认的 normal 模式（目录折叠成一条）：整棵新目录只算一项，避免大目录拖慢每次读状态。
    const status = await git(root, ['status', '--porcelain', '--untracked-files=normal'], { allowFail: true });
    const statusLines = status.ok && status.output !== '' ? status.output.split('\n') : [];
    const untrackedCount = statusLines.filter(line => line.startsWith('?? ')).length;
    const dirtyCount = statusLines.length - untrackedCount;
    const conflicts = await conflictedFiles(root);
    const refRes = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads'], { allowFail: true });
    const names = (refRes.ok ? refRes.output : '')
        .split('\n')
        .map(line => line.replace(/^refs\/heads\//, '').trim())
        .filter(Boolean);
    const branches = [];
    for (const name of names)
        branches.push(await readBranch(root, name));
    return { isRepo: true, root, current, inProgress, dirtyCount, untrackedCount, conflicts, branches, error: null };
}
/**
 * 给 git 路径参数加 literal 魔法。
 *
 * git 默认把 pathspec 当通配符，文件名里的 `*`、`?`、`[` 会误匹配别的文件；
 * 走面板提交的路径都是精确文件，必须按字面量解析。
 *
 * @param path 相对仓库根的路径。
 * @returns 带 literal 魔法的 pathspec。
 */
function literalPath(path) {
    return `:(literal)${path}`;
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
export async function listChanges(cwd) {
    const rootRes = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
    if (!rootRes.ok || rootRes.output === '')
        return [];
    const res = await git(rootRes.output, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], {
        allowFail: true,
        raw: true,
    });
    if (!res.ok)
        return [];
    const changes = [];
    for (const record of res.output.split('\0')) {
        if (record === '' || record.length < 4)
            continue;
        const x = record.charAt(0);
        const y = record.charAt(1);
        const path = record.slice(3);
        const untracked = x === '?' || y === '?';
        const added = x === 'A' || y === 'A';
        const deleted = x === 'D' || y === 'D';
        changes.push({
            path,
            status: untracked ? '?' : added ? 'A' : deleted ? 'D' : 'M',
            staged: !untracked && x !== ' ',
        });
    }
    return changes;
}
/** 单文件 diff 一次最多返回的行数，避免超大文件把面板噎住。 */
const MAX_DIFF_LINES = 2000;
/** 未跟踪文件预览的大小上限：再大就不读了，只提示。 */
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
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
export async function readFileDiff(cwd, path) {
    const rootRes = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
    if (!rootRes.ok || rootRes.output === '')
        return { diff: null, error: '当前目录不是 git 仓库' };
    const root = rootRes.output;
    const changes = await listChanges(root);
    const change = changes.find(item => item.path === path);
    if (change === undefined)
        return { diff: null, error: '该文件当前没有改动' };
    if (change.status === '?')
        return await readUntrackedDiff(root, path);
    // 还没有第一个提交时没有 HEAD 可对比，新文件同样按整文件新增处理。
    const hasHead = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true });
    if (!hasHead.ok)
        return await readUntrackedDiff(root, path);
    const res = await git(root, [
        'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', 'HEAD', '--', literalPath(path),
    ], { allowFail: true, raw: true });
    if (!res.ok)
        return { diff: null, error: '读取 diff 失败' };
    if (/^Binary files /m.test(res.output)) {
        return { diff: { path, patch: '', added: 0, deleted: 0, binary: true, truncated: false }, error: null };
    }
    return { diff: buildDiff(path, res.output), error: null };
}
/**
 * 给未跟踪的新文件生成「整文件新增」的 diff。
 *
 * 没有 HEAD 版本可以对比，所以直接读文件内容拼成 hunk；二进制（含 NUL 字节）只标类型，
 * 不展示内容。
 *
 * @param root 仓库根目录。
 * @param path 相对仓库根的路径。
 * @returns diff 结果。
 */
async function readUntrackedDiff(root, path) {
    const abs = join(root, path);
    try {
        const info = await lstat(abs);
        if (info.isSymbolicLink())
            return { diff: null, error: '符号链接暂不支持预览 diff' };
        if (!info.isFile())
            return { diff: null, error: '该改动不是普通文件，暂不支持预览' };
        if (info.size > MAX_DIFF_BYTES)
            return { diff: null, error: '文件太大，暂不支持预览' };
        const buffer = await readFile(abs);
        if (buffer.includes(0)) {
            return { diff: { path, patch: '', added: 0, deleted: 0, binary: true, truncated: false }, error: null };
        }
        const lines = buffer.toString('utf8').split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '')
            lines.pop();
        const kept = lines.slice(0, MAX_DIFF_LINES);
        const patch = [`@@ -0,0 +1,${kept.length} @@`, ...kept.map(line => `+${line}`)].join('\n');
        return {
            diff: {
                path,
                patch,
                added: kept.length,
                deleted: 0,
                binary: false,
                truncated: lines.length > kept.length,
            },
            error: null,
        };
    }
    catch {
        return { diff: null, error: '读取文件失败' };
    }
}
/**
 * 把统一 diff 文本收成结果对象，并按展示上限截断。
 *
 * @param path 相对仓库根的路径。
 * @param patch git 输出的统一 diff。
 * @returns diff 结果。
 */
function buildDiff(path, patch) {
    const lines = patch === '' ? [] : patch.replace(/\n$/, '').split('\n');
    const kept = lines.slice(0, MAX_DIFF_LINES);
    // 只统计 hunk 里的内容行：文件头里的 `---/+++` 不是增删，内容行本身也可能以 `++`/`--` 开头。
    let added = 0;
    let deleted = 0;
    let inHunk = false;
    for (const line of kept) {
        if (line.startsWith('@@')) {
            inHunk = true;
            continue;
        }
        if (!inHunk)
            continue;
        if (line.startsWith('+'))
            added += 1;
        else if (line.startsWith('-'))
            deleted += 1;
    }
    return { path, patch: kept.join('\n'), added, deleted, binary: false, truncated: lines.length > kept.length };
}
/**
 * 把没勾选的已暂存改动移出暂存区，工作区内容保持不动。
 *
 * 提交前调用：否则此前已经 `git add` 过的文件即使没勾选也会被带进这次提交。
 * 仓库还没有第一个提交（没有 HEAD）时，`git reset` 无从对照，改用 `git rm --cached`。
 *
 * @param root 仓库根目录。
 * @param changes 没勾选的改动；调用方只传已暂存的那些。
 */
async function unstagePaths(root, changes) {
    const paths = changes.map(change => literalPath(change.path));
    if (paths.length === 0)
        return;
    const hasHead = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true });
    if (hasHead.ok) {
        await git(root, ['reset', '--quiet', '--', ...paths], { allowFail: true });
        return;
    }
    await git(root, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...paths], { allowFail: true });
}
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
export async function commitWorkspace(cwd, message, files) {
    const text = message.trim();
    if (text === '')
        return { ok: false, message: '提交说明不能为空', output: '' };
    const inProgress = await detectInProgress(cwd);
    if (inProgress !== null) {
        return { ok: false, message: `${inProgress}：请先在冲突横幅里点「继续」或「中止」，再提交`, output: '' };
    }
    // 在仓库根上执行，会话工作目录可能是仓库的子目录。
    const rootRes = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
    if (!rootRes.ok || rootRes.output === '')
        return { ok: false, message: '当前目录不是 git 仓库', output: rootRes.output };
    const root = rootRes.output;
    // 以当前实际改动为准：浏览器传来的路径必须真实存在，避免把任意路径塞进暂存区。
    const changes = await listChanges(root);
    const available = new Set(changes.map(change => change.path));
    const chosen = files === undefined
        ? [...available]
        : [...new Set(files)].filter(path => available.has(path));
    if (chosen.length === 0)
        return { ok: false, message: '没有选择要提交的文件', output: '' };
    const chosenSet = new Set(chosen);
    const unselectedStaged = changes.filter(change => change.staged && !chosenSet.has(change.path));
    if (unselectedStaged.length > 0)
        await unstagePaths(root, unselectedStaged);
    const add = await git(root, ['add', '--all', '--', ...chosen.map(literalPath)], { allowFail: true });
    if (!add.ok)
        return { ok: false, message: '暂存选中的文件失败', output: add.output };
    const staged = await git(root, ['diff', '--cached', '--name-only', '-z'], { allowFail: true, raw: true });
    const stagedFiles = (staged.ok ? staged.output : '').split('\0').filter(path => path !== '');
    if (stagedFiles.length === 0)
        return { ok: true, message: '没有可提交的改动', output: '' };
    const res = await git(root, ['commit', '--quiet', '-m', text], { allowFail: true });
    if (!res.ok) {
        // 常见原因是 pre-commit 钩子失败；把 git 的第一行报错带出来，用户才知道要改什么。
        const detail = res.output.split('\n').map(line => line.trim()).find(line => line !== '') ?? '';
        return { ok: false, message: detail === '' ? '提交失败' : `提交失败：${detail}`, output: res.output };
    }
    const head = await git(root, ['rev-parse', '--short', 'HEAD'], { allowFail: true });
    const sha = head.ok ? head.output : '';
    const subject = text.split('\n')[0] ?? '';
    return {
        ok: true,
        message: `已提交 ${stagedFiles.length} 个文件${sha === '' ? '' : `（${sha}）`}：${subject}`,
        output: res.output,
    };
}
/**
 * 从起点分支创建分支；分支已存在时视为跳过而不是失败，便于流程重复执行。
 *
 * @param cwd 仓库目录。
 * @param branch 要创建的分支名。
 * @param base 起点分支。
 * @returns 执行结果。
 */
export async function createBranch(cwd, branch, base, mode = 'ff') {
    if (await hasTrackedChanges(cwd))
        return { ok: false, message: '已跟踪文件有未提交的改动，先提交或 stash', output: '' };
    if (await localBranchExists(cwd, branch))
        return { ok: true, message: `${branch} 已存在，跳过创建`, output: '' };
    if (await remoteBranchExists(cwd, branch))
        return { ok: true, message: `远端已有 ${branch}，跳过创建`, output: '' };
    if (!await localBranchExists(cwd, base))
        return { ok: false, message: `起点分支 ${base} 不存在`, output: '' };
    await fetchOrigin(cwd);
    // 起点分支先同步到远端最新，保证新分支从最新代码长出来。
    const baseSync = await syncBranch(cwd, base, mode);
    if (!baseSync.ok)
        return { ok: false, message: baseSync.message, output: '' };
    const checkout = await git(cwd, ['checkout', '--quiet', base], { allowFail: true });
    if (!checkout.ok)
        return { ok: false, message: `切换到 ${base} 失败`, output: checkout.output };
    const created = await git(cwd, ['checkout', '--quiet', '-b', branch], { allowFail: true });
    if (!created.ok)
        return { ok: false, message: `创建 ${branch} 失败`, output: created.output };
    const prefix = baseSync.status === 'fast-forward' || baseSync.status === 'merged'
        ? `${baseSync.message}；`
        : '';
    return { ok: true, message: `${prefix}已从 ${base} 创建 ${branch}`, output: '' };
}
/**
 * 把源分支合并进目标分支；目标已包含源时跳过。
 *
 * @param cwd 仓库目录。
 * @param source 源分支。
 * @param target 目标分支。
 * @returns 执行结果；冲突时 ok 为 false 并说明如何解决。
 */
export async function mergeInto(cwd, source, target, mode = 'ff') {
    if (await hasTrackedChanges(cwd))
        return { ok: false, message: '已跟踪文件有未提交的改动，先提交或 stash', output: '' };
    if (!await localBranchExists(cwd, source))
        return { ok: false, message: `源分支 ${source} 不存在`, output: '' };
    if (!await localBranchExists(cwd, target))
        return { ok: false, message: `目标分支 ${target} 不存在`, output: '' };
    // 先拉远端，避免基于过期引用做判断和合并。
    await fetchOrigin(cwd);
    // 来源分支也同步到远端最新：否则会把旧内容合进目标分支。
    const sourceSync = await syncBranch(cwd, source, mode);
    if (!sourceSync.ok) {
        return {
            ok: false,
            message: sourceSync.message,
            output: '',
            ...(sourceSync.conflicts === undefined ? {} : { conflicts: sourceSync.conflicts }),
        };
    }
    const contained = await git(cwd, ['merge-base', '--is-ancestor', source, target], { allowFail: true });
    if (contained.ok) {
        const note = sourceSync.status === 'fast-forward' ? `${sourceSync.message}；` : '';
        return { ok: true, message: `${note}${target} 已包含 ${source}，跳过合并`, output: '' };
    }
    const co = await git(cwd, ['checkout', '--quiet', target], { allowFail: true });
    if (!co.ok)
        return { ok: false, message: `切换到 ${target} 失败`, output: co.output };
    // 目标分支快进到远端最新，避免在过期分支上合并、也避免推送被拒。
    const targetSync = await syncBranch(cwd, target, mode);
    if (!targetSync.ok) {
        return {
            ok: false,
            message: `同步目标分支失败：${targetSync.message}`,
            output: '',
            ...(targetSync.conflicts === undefined ? {} : { conflicts: targetSync.conflicts }),
        };
    }
    const merged = await git(cwd, ['merge', '--no-ff', source, '-m', `Merge branch '${source}' into ${target}`], { allowFail: true });
    if (!merged.ok) {
        const conflicted = /CONFLICT|Automatic merge failed/.test(merged.output);
        if (conflicted) {
            const files = await conflictedFiles(cwd);
            return {
                ok: false,
                message: `合并 ${source} -> ${target} 有冲突，${files.length} 个文件待解决`,
                output: merged.output,
                conflicts: files,
            };
        }
        return { ok: false, message: `合并 ${source} -> ${target} 失败`, output: merged.output };
    }
    const notes = [sourceSync, targetSync]
        .filter(item => item.status === 'fast-forward' || item.status === 'merged')
        .map(item => item.message);
    const prefix = notes.length === 0 ? '' : `${notes.join('；')}；`;
    return { ok: true, message: `${prefix}已合并 ${source} -> ${target}`, output: merged.output };
}
/**
 * 推送一个分支到 origin。
 *
 * @param cwd 仓库目录。
 * @param branch 分支名。
 * @returns 推送结果。
 */
export async function pushBranch(cwd, branch) {
    const res = await git(cwd, ['push', '--quiet', 'origin', branch], { allowFail: true });
    return { ok: res.ok, message: res.ok ? `已推送 ${branch}` : `推送 ${branch} 失败`, output: res.output };
}
/**
 * 本地是否已有同名标签。
 *
 * @param cwd 仓库目录。
 * @param tag 标签名。
 * @returns 存在为 true。
 */
export async function localTagExists(cwd, tag) {
    const res = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { allowFail: true });
    return res.ok;
}
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
export async function createTag(cwd, tag, branch) {
    if (await localTagExists(cwd, tag))
        return { ok: true, message: `标签 ${tag} 已存在，跳过创建`, output: '' };
    let base = '';
    if (await localBranchExists(cwd, branch))
        base = branch;
    else if (await remoteBranchExists(cwd, branch))
        base = `origin/${branch}`;
    if (base === '')
        return { ok: false, message: `分支 ${branch} 不存在，无法打标签`, output: '' };
    const res = await git(cwd, ['tag', tag, base], { allowFail: true });
    if (!res.ok)
        return { ok: false, message: `打标签 ${tag} 失败`, output: res.output };
    const message = base === branch
        ? `已从 ${branch} 打标签 ${tag}`
        : `已在远端 ${branch} 上打标签 ${tag}`;
    return { ok: true, message, output: '' };
}
/**
 * 推送一个标签到 origin。
 *
 * 用 `refs/tags/` 全名推送：分支与标签可能同名，这样不会被 git 解析成别的引用。
 *
 * @param cwd 仓库目录。
 * @param tag 标签名。
 * @returns 推送结果。
 */
export async function pushTag(cwd, tag) {
    const res = await git(cwd, ['push', '--quiet', 'origin', `refs/tags/${tag}`], { allowFail: true });
    return { ok: res.ok, message: res.ok ? `已推送标签 ${tag}` : `推送标签 ${tag} 失败`, output: res.output };
}
/**
 * 是否还有进行中的合并（存在 MERGE_HEAD）。
 *
 * @param cwd 仓库目录。
 * @returns 合并中为 true。
 */
async function rebaseInProgress(cwd) {
    // rebase 的状态目录名随模式而变，交给 `git status` 的固定短语判断最稳。
    const status = await git(cwd, ['status'], { allowFail: true });
    return status.ok && /rebase in progress|interactive rebase in progress/i.test(status.output);
}
async function mergeInProgress(cwd) {
    const res = await git(cwd, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { allowFail: true });
    return res.ok;
}
/**
 * 中止进行中的合并，把工作区恢复到合并之前。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果。
 */
export async function abortMerge(cwd) {
    if (await rebaseInProgress(cwd)) {
        const res = await git(cwd, ['rebase', '--abort'], { allowFail: true });
        if (!res.ok)
            return { ok: false, message: '中止变基失败', output: res.output };
        return { ok: true, message: '已中止变基，工作区已还原', output: res.output };
    }
    if (!await mergeInProgress(cwd))
        return { ok: true, message: '当前没有进行中的合并或变基', output: '' };
    const res = await git(cwd, ['merge', '--abort'], { allowFail: true });
    if (!res.ok)
        return { ok: false, message: '中止合并失败', output: res.output };
    return { ok: true, message: '已中止合并，工作区已还原', output: res.output };
}
/**
 * 完成进行中的合并。
 *
 * 要求冲突文件都已解决并暂存：还有未合并路径时直接拒绝，避免把带冲突标记的
 * 文件提交进去。解决后用 `git commit --no-edit` 收尾，不弹编辑器。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果；仍有冲突时带上未解决的文件。
 */
export async function continueMerge(cwd) {
    const rebasing = await rebaseInProgress(cwd);
    if (!rebasing && !await mergeInProgress(cwd)) {
        return { ok: true, message: '当前没有进行中的合并或变基', output: '' };
    }
    const pending = await conflictedFiles(cwd);
    if (pending.length > 0) {
        return {
            ok: false,
            message: `还有 ${pending.length} 个文件未解决，先在终端解决并 git add`,
            output: '',
            conflicts: pending,
        };
    }
    // 变基用 rebase --continue（把 core.editor 置空避免弹编辑器）；合并用 commit --no-edit。
    const res = rebasing
        ? await git(cwd, ['-c', 'core.editor=true', 'rebase', '--continue'], { allowFail: true })
        : await git(cwd, ['commit', '--no-edit'], { allowFail: true });
    if (!res.ok) {
        const text = res.output;
        // 冲突全部取「当前分支」时可能没有需要提交的改动，此时合并已被 git 自行结束。
        if (/nothing to commit|no changes added to commit/.test(text)) {
            return { ok: true, message: '冲突已解决（没有需要提交的改动）', output: text };
        }
        return { ok: false, message: '完成合并失败', output: text };
    }
    return { ok: true, message: rebasing ? '冲突已解决，变基完成' : '冲突已解决，合并完成', output: res.output };
}
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
export async function checkoutBranch(cwd, branch) {
    if (branch === '' || branch === 'HEAD')
        return { ok: false, message: '没有可切回的分支', output: '' };
    if (await mergeInProgress(cwd))
        return { ok: false, message: '还有进行中的合并，先处理冲突再切回', output: '' };
    if (await hasTrackedChanges(cwd))
        return { ok: false, message: '工作区有未提交改动，先提交或 stash 再切回', output: '' };
    if (!await localBranchExists(cwd, branch))
        return { ok: false, message: `分支 ${branch} 已不存在`, output: '' };
    const res = await git(cwd, ['checkout', '--quiet', branch], { allowFail: true });
    if (!res.ok)
        return { ok: false, message: `切回 ${branch} 失败`, output: res.output };
    return { ok: true, message: `已切回 ${branch}`, output: res.output };
}
/**
 * 拉取远端（含清理已删分支），不触碰工作区。
 *
 * @param cwd 仓库目录。
 */
export async function fetchOrigin(cwd) {
    await git(cwd, ['fetch', '--prune', '--quiet', 'origin'], { allowFail: true });
}
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
export async function syncBranch(cwd, branch, mode = 'ff') {
    if (!await localBranchExists(cwd, branch)) {
        return { ok: false, status: 'missing', message: `分支 ${branch} 不存在` };
    }
    if (!await remoteBranchExists(cwd, branch)) {
        return { ok: true, status: 'no-remote', message: '' };
    }
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`], { allowFail: true });
    const parts = (counts.ok ? counts.output : '0 0').split(/\s+/).map(n => Number.parseInt(n, 10));
    const behind = Number.isFinite(parts[0]) ? parts[0] ?? 0 : 0;
    const ahead = Number.isFinite(parts[1]) ? parts[1] ?? 0 : 0;
    if (behind === 0)
        return { ok: true, status: 'up-to-date', message: '' };
    if (ahead > 0) {
        // 分叉：默认策略是停下来让人决定；merge 策略则把远端最新合并进来。
        if (mode === 'ff') {
            return {
                ok: false,
                status: 'diverged',
                message: `${branch} 与远端分叉（本地领先 ${ahead}、落后 ${behind}），请先手动 git pull 处理后再执行`,
            };
        }
        const currentBranch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).output;
        if (currentBranch !== branch) {
            const co = await git(cwd, ['checkout', '--quiet', branch], { allowFail: true });
            if (!co.ok)
                return { ok: false, status: 'diverged', message: `切换到 ${branch} 失败` };
        }
        if (mode === 'rebase') {
            const rebased = await git(cwd, ['rebase', `origin/${branch}`], { allowFail: true });
            if (!rebased.ok) {
                const files = await conflictedFiles(cwd);
                const rebaseStuck = await rebaseInProgress(cwd);
                if (rebaseStuck) {
                    return {
                        ok: false,
                        status: 'diverged',
                        message: files.length > 0
                            ? `${branch} 变基到远端时有冲突，${files.length} 个文件待解决`
                            : `${branch} 变基中断，需手动 git rebase --continue 或 --abort`,
                        conflicts: files,
                    };
                }
                return { ok: false, status: 'diverged', message: `${branch} 变基到远端失败` };
            }
            return { ok: true, status: 'rebased', message: `已把 ${branch} 变基到远端最新（重放 ${ahead} 个本地提交）` };
        }
        const merged = await git(cwd, ['merge', '--no-edit', `origin/${branch}`], { allowFail: true });
        if (!merged.ok) {
            const files = await conflictedFiles(cwd);
            if (files.length > 0) {
                return {
                    ok: false,
                    status: 'diverged',
                    message: `${branch} 合并远端最新时有冲突，${files.length} 个文件待解决`,
                    conflicts: files,
                };
            }
            return { ok: false, status: 'diverged', message: `${branch} 合并远端最新失败` };
        }
        return { ok: true, status: 'merged', message: `已把远端最新合并进 ${branch}（本地领先 ${ahead}、落后 ${behind}）` };
    }
    const current = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).output;
    // 当前分支用 ff-only 合并；其它分支直接更新引用，避免来回切换。
    const res = current === branch
        ? await git(cwd, ['merge', '--ff-only', '--quiet', `origin/${branch}`], { allowFail: true })
        : await git(cwd, ['fetch', '--quiet', 'origin', `${branch}:${branch}`], { allowFail: true });
    if (!res.ok) {
        return { ok: false, status: 'diverged', message: `${branch} 无法快进到远端最新，请手动处理`, };
    }
    return { ok: true, status: 'fast-forward', message: `已把 ${branch} 快进到远端最新（${behind} 个提交）` };
}
/**
 * 从 origin 拉取远端更新（含清理已删除的远端分支）。
 *
 * 只做 `fetch --prune`，不动工作区、不改本地分支，因此任何时候都安全。拉取后统计
 * 各本地分支落后远端多少，让调用方能告诉用户"哪些分支有更新"。
 *
 * @param cwd 仓库目录。
 * @returns 执行结果，`updated` 列出落后于远端的分支。
 */
export async function fetchRemote(cwd) {
    const hasRemote = await git(cwd, ['remote', 'get-url', 'origin'], { allowFail: true });
    if (!hasRemote.ok)
        return { ok: false, message: '这个仓库没有配置 origin 远端', output: '' };
    const res = await git(cwd, ['fetch', '--prune', '--quiet', 'origin'], { allowFail: true });
    if (!res.ok)
        return { ok: false, message: '拉取远端失败（网络或权限问题）', output: res.output };
    const refs = await git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads'], { allowFail: true });
    const names = (refs.ok ? refs.output : '')
        .split('\n')
        .map(line => line.replace(/^refs\/heads\//, '').trim())
        .filter(Boolean);
    const updated = [];
    for (const name of names) {
        if (!await remoteBranchExists(cwd, name))
            continue;
        const counts = await git(cwd, ['rev-list', '--left-right', '--count', `origin/${name}...${name}`], { allowFail: true });
        if (!counts.ok)
            continue;
        const behind = Number.parseInt(counts.output.split(/\s+/)[0] ?? '0', 10) || 0;
        if (behind > 0)
            updated.push({ name, behind });
    }
    const summary = updated.length === 0
        ? '已拉取，本地分支都已是最新'
        : `已拉取；这些本地分支仍落后远端（合并时会对目标分支自动快进）：${updated.map(item => `${item.name} ↓${item.behind}`).join('，')}`;
    return { ok: true, message: summary, output: res.output, updated };
}
