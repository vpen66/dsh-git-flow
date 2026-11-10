/**
 * 最近一次步骤执行结果的持久化。
 *
 * 前端按步骤驱动执行，失败状态原本只存在浏览器内存里：关掉面板或重启应用就没了，
 * 用户会误以为"什么都没发生"。这里把每次执行的结果按仓库记到
 * `~/.dsh/git-flow/last-run.json`，面板打开时读回来，用顶部横幅显示上次失败。
 *
 * 只保存最近一次，不承担完整历史；文件体积靠截断输出与仓库数量上限控制。
 *
 * @module dsh-git-flow/runs
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** 当前文件版本。 */
const RUN_FILE_VERSION = 1;
/** 单个 output 的字符上限，避免把文件写大。 */
const MAX_OUTPUT_CHARS = 4000;
/** 最多保留多少个仓库的最近记录，超出时按时间淘汰。 */
const MAX_REPOS = 20;
/** 最近执行记录文件位置。 */
export function lastRunPath() {
    return join(homedir(), '.dsh', 'git-flow', 'last-run.json');
}
/**
 * 截断过长的输出，保留开头（错误原因通常在最前面）。
 *
 * @param output 原始输出。
 * @returns 截断后的输出。
 */
function clipOutput(output) {
    if (output.length <= MAX_OUTPUT_CHARS)
        return output;
    return `${output.slice(0, MAX_OUTPUT_CHARS)}\n…（输出过长，已截断）`;
}
/** 最近执行记录存储。读-改-写串行化，写入为原子替换。 */
export class RunStore {
    /** 串行化文件写入。 */
    queue = Promise.resolve();
    /**
     * 把一段任务串到队列末尾。
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
     * 读取整份记录文件；损坏或不存在时按空文件处理。
     *
     * @returns 解析后的内容。
     */
    async readFileSafe() {
        try {
            const parsed = JSON.parse(await readFile(lastRunPath(), 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
                return { version: RUN_FILE_VERSION, repos: {} };
            const file = parsed;
            const repos = {};
            if (typeof file.repos === 'object' && file.repos !== null && !Array.isArray(file.repos)) {
                for (const [root, value] of Object.entries(file.repos)) {
                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        repos[root] = value;
                    }
                }
            }
            return { version: RUN_FILE_VERSION, repos };
        }
        catch {
            return { version: RUN_FILE_VERSION, repos: {} };
        }
    }
    /**
     * 原子写入整份记录文件。
     *
     * @param file 要写入的内容。
     */
    async writeFileNow(file) {
        const path = lastRunPath();
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
        try {
            await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
            await rename(temp, path);
        }
        catch (error) {
            await unlink(temp).catch(() => { });
            throw error;
        }
    }
    /**
     * 记录一次步骤结果；同一仓库只保留最近一次。
     *
     * @param record 步骤结果（at 省略时取当前时间）。
     */
    async record(record) {
        await this.enqueue(async () => {
            const file = await this.readFileSafe();
            const stored = {
                ...record,
                at: record.at ?? new Date().toISOString(),
                output: clipOutput(record.output),
            };
            file.repos[record.repoRoot] = stored;
            // 仓库数量有上限：按时间淘汰最旧的，避免文件无限增长。
            const entries = Object.entries(file.repos);
            if (entries.length > MAX_REPOS) {
                entries.sort((left, right) => (left[1].at < right[1].at ? 1 : -1));
                file.repos = Object.fromEntries(entries.slice(0, MAX_REPOS));
            }
            await this.writeFileNow(file);
        });
    }
    /**
     * 读取某个仓库的最近一次步骤结果。
     *
     * @param repoRoot 仓库工作目录。
     * @returns 记录；没有记录时返回 null。
     */
    async read(repoRoot) {
        return this.enqueue(async () => {
            const file = await this.readFileSafe();
            return file.repos[repoRoot] ?? null;
        });
    }
    /**
     * 清除某个仓库的最近记录（用户点「忽略」时调用）。
     *
     * @param repoRoot 仓库工作目录。
     */
    async clear(repoRoot) {
        await this.enqueue(async () => {
            const file = await this.readFileSafe();
            if (file.repos[repoRoot] === undefined)
                return;
            delete file.repos[repoRoot];
            await this.writeFileNow(file);
        });
    }
}
