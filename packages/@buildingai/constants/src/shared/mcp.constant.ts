/**
 * MCP服务类型
 */
export const McpServerType = {
    /**
     * 用户自定义服务
     */
    USER: "user",

    /**
     * 系统内置服务
     */
    SYSTEM: "system",
} as const;

export type McpServerType = (typeof McpServerType)[keyof typeof McpServerType];

/**
 * MCP服务通信的传输方式
 */
export const McpCommunicationType = {
    /**
     * SSE
     */
    SSE: "sse",

    /**
     * StreamableHTTP
     */
    STREAMABLEHTTP: "streamable-http",
} as const;

export type McpCommunicationType = (typeof McpCommunicationType)[keyof typeof McpCommunicationType];
