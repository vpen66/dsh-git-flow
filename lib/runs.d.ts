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
/** 一次步骤执行的持久化快照。 */
export interface LastStepRecord {
    /** ISO 时间戳。 */
    at: string;
    /** 仓库工作目录（与面板请求里的会话目录一致）。 */
    repoRoot: string;
    /** 指令名，方便横幅显示。 */
    templateName?: string;
    /** 步骤下标（0 开始）。 */
    stepIndex?: number;
    stepId: string;
    kind: string;
    source: string;
    target: string;
    ok: boolean;
    skipped: boolean;
    message: string;
    /** git 原始输出；超过上限会截断。 */
    output: string;
    conflicts?: string[];
}
/** 最近执行记录文件位置。 */
export declare function lastRunPath(): string;
/** 最近执行记录存储。读-改-写串行化，写入为原子替换。 */
export declare class RunStore {
    /** 串行化文件写入。 */
    private queue;
    /**
     * 把一段任务串到队列末尾。
     *
     * @param task 要执行的任务。
     * @returns 任务结果。
     */
    private enqueue;
    /**
     * 读取整份记录文件；损坏或不存在时按空文件处理。
     *
     * @returns 解析后的内容。
     */
    private readFileSafe;
    /**
     * 原子写入整份记录文件。
     *
     * @param file 要写入的内容。
     */
    private writeFileNow;
    /**
     * 记录一次步骤结果；同一仓库只保留最近一次。
     *
     * @param record 步骤结果（at 省略时取当前时间）。
     */
    record(record: Omit<LastStepRecord, 'at'> & {
        at?: string;
    }): Promise<void>;
    /**
     * 读取某个仓库的最近一次步骤结果。
     *
     * @param repoRoot 仓库工作目录。
     * @returns 记录；没有记录时返回 null。
     */
    read(repoRoot: string): Promise<LastStepRecord | null>;
    /**
     * 清除某个仓库的最近记录（用户点「忽略」时调用）。
     *
     * @param repoRoot 仓库工作目录。
     */
    clear(repoRoot: string): Promise<void>;
}
