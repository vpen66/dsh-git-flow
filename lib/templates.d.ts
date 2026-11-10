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
/** 变量取值方式：手填分支名，或从仓库现有分支里挑。 */
export type VariableKind = 'input' | 'pick';
/** 从来源变量里截取片段的方式。 */
export type DeriveTake = 'after-slash' | 'last-segment' | 'whole';
/**
 * 变量推导规则：从另一个变量的值里截取片段，加上前缀，得到本变量的自动填充值。
 *
 * 例：`feature` 的值是 `feature/v1.0.1`，规则为
 * `{ from: 'feature', take: 'after-slash', prefix: 'release/' }`，
 * 则本变量推导为 `release/v1.0.1`。
 */
export interface VariableDerive {
    /** 来源变量的 key。 */
    from: string;
    /** 截取方式，默认 after-slash：取第一个 `/` 之后的部分。 */
    take?: DeriveTake;
    /** 拼在前面的前缀，例如 `release/`。 */
    prefix?: string;
}
/** 模板变量声明。 */
export interface TemplateVariable {
    /** 占位名，步骤里写 `{key}` 引用。 */
    key: string;
    /** 表单上显示的中文名。 */
    label: string;
    /** input 手填，pick 从现有分支里选。 */
    kind: VariableKind;
    /** pick 时用于过滤分支的通配符，例如 `feature/*`；省略表示全部。 */
    pattern?: string;
    /** 表单默认值；有 derive 时作为来源为空时的兜底。 */
    default?: string;
    /** 自动填充规则；来源有值时覆盖默认值。 */
    derive?: VariableDerive;
}
/** 步骤种类：建分支、合并分支、只把某个分支推到远端，或在分支上打标签。 */
export type StepKind = 'create' | 'merge' | 'push' | 'tag';
/** 一个执行步骤。 */
export interface WorkflowStep {
    /** 稳定标识，前端用来记录每一步的状态。 */
    id: string;
    kind: StepKind;
    /** 建分支时的起点、合并时的来源，或打标签时的来源分支。允许 `{变量}`；`push` 步骤不用它。 */
    source: string;
    /** 建分支/合并的目标分支；`tag` 步骤里表示标签名；`push` 步骤里表示要推送的分支。允许 `{变量}`。 */
    target: string;
    /** 该步之后是否推送目标分支（`tag` 步骤是推送标签）。 */
    push: boolean;
    /** 可选备注，显示在步骤标题旁。 */
    note?: string;
}
/** 一个完整的工作流模板。 */
export interface WorkflowTemplate {
    id: string;
    name: string;
    description?: string;
    /**
     * 本地分支与远端分叉时怎么办：
     * - `merge`（默认）：`git merge origin/x`，留一个合并提交；
     * - `rebase`：`git rebase origin/x`，本地提交重放到远端之上，历史线性；
     * - `ff`：只快进，分叉就停下，由人手动处理。
     */
    sync?: 'ff' | 'merge' | 'rebase';
    variables: TemplateVariable[];
    steps: WorkflowStep[];
    /**
     * 校验失败的原因。只在读取时由服务端补上：损坏的模板不丢弃、不静默删除，
     * 而是带着原因返回，界面标为「无效」并拒绝执行，用户仍能编辑修复或导出。
     */
    invalid?: string;
}
/** 模板文件的磁盘格式。 */
export interface TemplateFile {
    /** 写入时总是当前版本；读取时可能是更旧的版本号。 */
    version: number;
    templates: WorkflowTemplate[];
}
/** 模板文件位置。 */
export declare function templatesPath(): string;
/** 备份目录；每次覆盖模板文件前把旧版本留一份。 */
export declare function backupsDir(): string;
/**
 * 把当前模板文件复制一份带时间戳的备份。
 *
 * 文件不存在时什么也不做。备份失败不阻断保存——保住数据是好事，但不能因此让
 * 用户连模板都存不了。
 */
export declare function backupTemplates(): Promise<void>;
/**
 * 生成一个默认的发布流程模板。
 *
 * 与团队现有的发布习惯一致：从 develop 拉 release，合入 feature，先发预发、
 * 再发生产，最后把 release 回流 develop 与 master。用户可以在此之上改。
 *
 * @returns 默认模板。
 */
export declare function defaultReleaseTemplate(): WorkflowTemplate;
/** 当前模板文件版本；2 起支持变量推导，3 起支持打标签步骤。 */
export declare const TEMPLATE_FILE_VERSION = 3;
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
export declare function computeDerived(variable: TemplateVariable, values: Record<string, string>): string;
/**
 * 把模板里所有变量的推导值算一遍，用于表单初始值。
 *
 * 支持链式推导（A 由 B 推导、B 由 C 推导），最多回溯变量数量轮。
 *
 * @param variables 变量声明。
 * @param values 初始取值。
 * @returns 补齐推导后的取值。
 */
export declare function applyDerived(variables: TemplateVariable[], values: Record<string, string>): Record<string, string>;
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
export declare function migrateTemplates(templates: WorkflowTemplate[], version: number): WorkflowTemplate[];
/**
 * 校验一个模板对象是否可以安全执行。
 *
 * @param value 待校验的未知值。
 * @returns 错误说明；通过时返回 null。
 */
export declare function validateTemplate(value: unknown): string | null;
/**
 * 取出一个字段里引用的全部变量名。
 *
 * @param field 可能是 `{base}` 或 `release/1.0.5` 的字符串。
 * @returns 变量名数组，按出现顺序。
 */
export declare function placeholdersOf(field: string): string[];
/**
 * 把 `{变量}` 替换成实际值。
 *
 * @param field 模板字段。
 * @param values 变量取值。
 * @returns 替换后的分支名。
 */
export declare function renderField(field: string, values: Record<string, string>): string;
/** 模板存储：读、写、初始化。 */
export declare class TemplateStore {
    /** 串行化模板文件的每一次读-改-写，避免并发保存互相覆盖。 */
    private queue;
    /**
     * 把一段任务串到队列末尾；前一个任务失败也继续排队。
     *
     * @param task 要执行的任务。
     * @returns 任务结果。
     */
    private enqueue;
    /**
     * 读取全部模板；文件不存在时写入默认模板再返回。
     *
     * @returns 模板列表。
     */
    load(): Promise<WorkflowTemplate[]>;
    /**
     * 读全部模板，并按需写回默认模板或迁移结果。
     *
     * 只在队列任务内部调用：它可能写盘，但不会再次入队，因此不会自锁。
     *
     * @returns 模板列表。
     */
    private readForWrite;
    /**
     * 覆盖写入全部模板。
     *
     * @param templates 模板列表。
     */
    save(templates: WorkflowTemplate[]): Promise<void>;
    /**
     * 原子写入模板文件：先写临时文件再 rename。
     *
     * 直接覆盖时若进程崩溃会留下截断 JSON，下一次 load() 只能靠备份找回。
     *
     * @param templates 模板列表。
     */
    private writeNow;
    /**
     * 新增或更新一个模板。
     *
     * @param template 模板对象。
     * @returns 保存后的全部模板。
     */
    upsert(template: WorkflowTemplate): Promise<WorkflowTemplate[]>;
    /**
     * 确保内置的默认发布模板存在；已被删除时重新加回来。
     *
     * @returns 恢复后的全部模板，以及这次是否真的补上了。
     */
    ensureDefault(): Promise<{
        templates: WorkflowTemplate[];
        restored: boolean;
    }>;
    /**
     * 删除一个模板。
     *
     * @param id 模板 id。
     * @returns 删除后的全部模板。
     */
    remove(id: string): Promise<WorkflowTemplate[]>;
}
