/** 行分隔 JSON-RPC 消息类型（Tauri Rust Core ↔ Node sidecar 契约） */

export type RpcId = string | number;

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: RpcId;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: RpcId;
    result?: unknown;
    error?: JsonRpcErrorObject;
}

export const RpcErrorCodes = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    /** 策略硬拒绝（黑名单 / 工作区外操作） */
    PolicyDenied: -32001,
    /** 用户在审批中拒绝 */
    ApprovalDenied: -32002,
    /** 等待审批超时 */
    ApprovalTimeout: -32003,
} as const;

export class RpcError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.name = "RpcError";
        this.code = code;
        this.data = data;
    }
}

/** 服务端 → 客户端通知方法名 */
export const ServerNotifications = {
    EngineEvent: "engine/event",
    ApprovalRequest: "approval/request",
    AuditBatchDropped: "audit/batch-dropped",
} as const;

/** 客户端 → 服务端通知方法名 */
export const ClientNotifications = {
    ApprovalRespond: "approval/respond",
} as const;
