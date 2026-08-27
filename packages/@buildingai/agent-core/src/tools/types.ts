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

export interface PlatformTool {
    name: string;
    description: string;
    parameters: JsonSchema;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}
