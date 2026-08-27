import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PlatformTool } from "../tools/types.js";

/**
 * PlatformTool → pi ToolDefinition 转换器。
 * 平台侧持有 JSON Schema 参数描述与受策略管控的 execute；
 * pi 只见到 name/description/parameters 与结果文本。
 * 错误以文本形式返回给模型（可自愈重试），异常只用于真正致命故障。
 */
export function toPiTools(tools: PlatformTool[]): ToolDefinition[] {
    return tools.map((tool) =>
        defineTool({
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {},
                required: (tool.parameters as { required?: string[] }).required ?? [],
            } as never,
            execute: async (_callId: string, params: Record<string, unknown>) => {
                try {
                    const result = await tool.execute(params ?? {});
                    return {
                        content: [{ type: "text" as const, text: result.summary }],
                        details: {},
                    };
                } catch (err) {
                    const message =
                        err instanceof Error
                            ? `${err.name}: ${err.message}`
                            : String(err);
                    return {
                        content: [{ type: "text" as const, text: `工具执行失败：${message}` }],
                        details: {},
                    };
                }
            },
        }),
    );
}
