import type { PlatformTool } from "../tools/types.js";

/**
 * Agent 引擎接口抽象（ADR-02 的"换 harness 保险丝"）。
 *
 * 四个原语：启动、消息流、工具注册、引擎生命周期控制。
 * 一期实现为 PiEngine（基于 @earendil-works/pi-coding-agent），
 * 未来可替换为 Codex app-server 或国产 harness 而不动客户端架构。
 */
export interface AgentEngine {
    readonly name: string;

    /** 注入模型接入信息与平台已注册工具；引擎在此完成自身初始化 */
    start(config: EngineStartConfig): Promise<void>;

    /**
     * 发送用户消息并获取事件流。
     * 流结束（done/error 事件）前调用方不得发起同会话的下一条消息；
     * 中途放弃可直接 abort。
     */
    sendMessage(sessionId: string, input: UserInput): AsyncIterable<EngineEvent>;

    /** 注册平台自有工具（文件/终端/办公套件由平台策略层管控后注入引擎） */
    registerTools(tools: PlatformTool[]): void;

    /** 中断指定会话当前正在进行的推理/执行 */
    abort(sessionId: string): void;

    /** 优雅释放资源（子进程、连接等） */
    dispose(): Promise<void>;
}

export interface EngineStartConfig {
    /** 模型接入点。生产环境为服务端网关代理地址；密钥永不下发客户端 */
    modelGatewayUrl: string;
    /** 网关短期凭证（登录会话级） */
    gatewayToken: string;
    /** 默认模型标识，如 {provider, modelId} */
    defaultModel?: ModelRef;
    /** 会话数据（正文）落盘目录；默认仅存本地 */
    storageDir: string;
}

export interface ModelRef {
    provider: string;
    modelId: string;
    /** 可选推理档位；harness 自行解释 */
    thinkingLevel?: string;
}

export interface UserInput {
    text: string;
    /** 本地文件引用（工作区内路径），供多模态场景使用 */
    fileRefs?: string[];
}

export type EngineEvent =
    | { type: "text_delta"; delta: string }
    | { type: "thinking_delta"; delta: string }
    | { type: "tool_call_start"; callId: string; name: string; argsPreview: string }
    | { type: "tool_call_end"; callId: string; ok: boolean; durationMs: number; resultPreview?: string }
    | { type: "usage"; inputTokens: number; outputTokens: number }
    | { type: "session_created"; sessionId: string }
    | { type: "error"; message: string; recoverable: boolean }
    | { type: "done"; stopReason: "end_turn" | "aborted" | "max_steps" };
