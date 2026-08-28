/** 平台自有工具：由策略层管控后注入 Agent 引擎 */

/** 标准工具结果 */
export interface ToolResult {
    ok: boolean;
    /** 给模型看的文本摘要（截断后） */
    summary: string;
    /** 结构化数据，随审计上报 */
    data?: Record<string, unknown>;
}

/** JSON Schema 描述的参数定义 */
export type JsonSchema = Record<string, unknown>;

/** 工作台模式（与 engine/types 的 AgentMode 同构，避免循环依赖的轻量别名） */
export type ToolMode = "code" | "work";

/** 工具执行上下文：由引擎在建会话时绑定（对齐 Kun 工具的 thread 语义） */
export interface ToolExecutionContext {
    /** 触发该工具调用的平台会话 id */
    sessionId: string;
}

export interface PlatformTool {
    name: string;
    description: string;
    parameters: JsonSchema;
    execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult>;
    /**
     * T2.4 工具按模式隔离：仅在列出的模式中广告（缺省=全部模式）。
     * 引擎建会话时按会话模式过滤 customTools，另一模式的工具完全不可见。
     */
    modes?: ToolMode[];
}
