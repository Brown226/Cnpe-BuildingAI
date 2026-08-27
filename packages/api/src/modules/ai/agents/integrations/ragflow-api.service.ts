import { HttpErrorFactory } from "@buildingai/errors";
import type { ThirdPartyIntegrationConfig } from "@buildingai/types/ai/agent-config.interface";
import { Injectable, Logger } from "@nestjs/common";

/**
 * RagFlow 聊天助手基础信息。
 */
export interface RagflowAppInfo {
    name?: string;
    description?: string;
    prologue?: string;
    raw: Record<string, any>;
}

/**
 * RagFlow 会话信息。
 */
export interface RagflowSession {
    id: string;
    chatId?: string;
    name?: string;
    userId?: string;
    raw: Record<string, any>;
}

/**
 * RagFlow 对话 token 用量。
 *
 * @description 原生 `/api/v1/chat/completions` 流式响应不返回 usage，通常为空。
 */
export interface RagflowChatUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

/**
 * RagFlow 知识库引用块。
 */
export interface RagflowReferenceChunk {
    id?: string;
    content?: string;
    documentName?: string;
    datasetName?: string;
    similarity?: number;
    raw: Record<string, any>;
}

/**
 * RagFlow 流式对话参数。
 */
export interface RagflowStreamChatParams {
    config: ThirdPartyIntegrationConfig;
    userId: string;
    question: string;
    sessionId?: string;
}

/**
 * 解析后的 RagFlow SSE 事件块。
 */
export interface RagflowStreamEvent {
    code?: number;
    message?: string;
    /** `data` 载荷；流末尾的正常结束块为布尔值 true。 */
    data?: Record<string, any> | boolean;
    rawData?: string;
}

/**
 * RagFlow OpenAPI 访问服务。
 *
 * @description
 * RagFlow 的 API Key 绑定租户而非应用，因此除 baseURL + apiKey 外，
 * 还需通过 appId 指定目标聊天助手（chat assistant 的 chat_id）。
 * 用户隔离通过「创建会话时写入 user_id」实现：
 * 创建会话（POST /api/v1/chats/{chat_id}/sessions，body 带 user_id）
 * → 后续对话携带 session_id，会话归属即隔离。
 *
 * @see docs/ragflow-http-api-reference.md
 */
@Injectable()
export class RagflowApiService {
    private readonly logger = new Logger(RagflowApiService.name);

    /**
     * 本地单机部署默认地址。
     */
    readonly defaultBaseUrl = "http://localhost:9380";

    /**
     * 规范化第三方配置。
     */
    normalizeConfig(config?: ThirdPartyIntegrationConfig | null): ThirdPartyIntegrationConfig {
        const normalized = {
            ...(config ?? {}),
        } as ThirdPartyIntegrationConfig & { provider?: "coze" | "dify" | "ragflow" };
        const extendedConfig = { ...(config?.extendedConfig ?? {}) };

        extendedConfig.provider = "ragflow";
        normalized.provider = "ragflow";
        normalized.apiKey = config?.apiKey?.trim();
        normalized.baseURL = this.normalizeBaseUrl(config?.baseURL);
        normalized.appId = config?.appId?.trim();
        normalized.extendedConfig = extendedConfig;

        return normalized;
    }

    /**
     * 判断当前配置是否满足 RagFlow 最小可用条件。
     *
     * @description RagFlow 需要 apiKey + appId（chat_id），Key 只绑定租户。
     */
    hasValidConfig(config?: ThirdPartyIntegrationConfig | null): boolean {
        const normalized = this.normalizeConfig(config);
        return Boolean(normalized.apiKey && normalized.appId);
    }

    /**
     * 获取聊天助手基础信息（名称、描述、开场白）。
     *
     * @see GET /api/v1/chats/{chat_id}
     */
    async getChatAssistant(
        config?: ThirdPartyIntegrationConfig | null,
    ): Promise<RagflowAppInfo> {
        const normalized = this.normalizeConfig(config);
        const apiKey = normalized.apiKey?.trim();
        const chatId = normalized.appId?.trim();

        if (!apiKey || !chatId) {
            throw HttpErrorFactory.badRequest("RagFlow API Key 或 Chat ID 未配置");
        }

        const url = `${normalized.baseURL}/chats/${chatId}`;

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: this.buildHeaders(apiKey),
            });

            if (!response.ok) {
                const text = await response.text();
                throw HttpErrorFactory.badRequest(
                    `获取 RagFlow 助手信息失败: HTTP ${response.status} ${text}`,
                );
            }

            const payload = (await response.json()) as { code?: number; message?: string; data?: Record<string, any> };
            if (payload.code !== 0 || !payload.data) {
                throw HttpErrorFactory.badRequest(
                    `获取 RagFlow 助手信息失败: ${payload.message ?? "未知错误"}`,
                );
            }

            return this.mapAppInfo(payload.data);
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("获取 RagFlow")) {
                throw error;
            }
            const msg = this.errMsg(error);
            this.logger.warn(`RagFlow chat assistant request failed: ${url}, error=${msg}`);
            throw HttpErrorFactory.badRequest(`获取 RagFlow 助手信息失败: ${msg}`);
        }
    }

    /**
     * 在聊天助手下创建会话，并绑定平台用户标识以实现用户隔离。
     *
     * @see POST /api/v1/chats/{chat_id}/sessions
     */
    async createSession(
        config: ThirdPartyIntegrationConfig,
        params: { userId: string; name?: string },
    ): Promise<RagflowSession> {
        const normalized = this.normalizeConfig(config);
        const apiKey = normalized.apiKey?.trim();
        const chatId = normalized.appId?.trim();

        if (!apiKey || !chatId) {
            throw HttpErrorFactory.badRequest("RagFlow API Key 或 Chat ID 未配置");
        }

        const url = `${normalized.baseURL}/chats/${chatId}/sessions`;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.buildHeaders(apiKey),
                body: JSON.stringify({
                    name: params.name ?? "",
                    user_id: params.userId,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw HttpErrorFactory.badRequest(
                    `创建 RagFlow 会话失败: HTTP ${response.status} ${text}`,
                );
            }

            const payload = (await response.json()) as { code?: number; message?: string; data?: Record<string, any> };
            if (payload.code !== 0 || !payload.data?.id) {
                throw HttpErrorFactory.badRequest(
                    `创建 RagFlow 会话失败: ${payload.message ?? "未知错误"}`,
                );
            }

            return {
                id: String(payload.data.id),
                chatId: payload.data.chat_id ? String(payload.data.chat_id) : chatId,
                name: payload.data.name ? String(payload.data.name) : undefined,
                userId: payload.data.user_id ? String(payload.data.user_id) : params.userId,
                raw: payload.data,
            };
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("创建 RagFlow 会话失败")) {
                throw error;
            }
            const msg = this.errMsg(error);
            this.logger.warn(`RagFlow create session request failed: ${url}, error=${msg}`);
            throw HttpErrorFactory.badRequest(`创建 RagFlow 会话失败: ${msg}`);
        }
    }

    /**
     * 发起 RagFlow 流式对话请求。
     *
     * @see POST /api/v1/chat/completions
     */
    async streamChat(params: RagflowStreamChatParams): Promise<Response> {
        const normalized = this.normalizeConfig(params.config);
        const apiKey = normalized.apiKey?.trim();
        const chatId = normalized.appId?.trim();

        if (!apiKey || !chatId) {
            throw HttpErrorFactory.badRequest("RagFlow API Key 或 Chat ID 未配置");
        }
        if (!params.question.trim()) {
            throw HttpErrorFactory.badRequest("RagFlow 对话内容不能为空");
        }

        const body: Record<string, any> = {
            chat_id: chatId,
            question: params.question,
            stream: true,
        };

        if (params.sessionId) {
            body.session_id = params.sessionId;
        }

        const url = `${normalized.baseURL}/chat/completions`;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    ...this.buildHeaders(apiKey),
                    Accept: "text/event-stream, application/json",
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const text = await response.text();
                throw HttpErrorFactory.badRequest(
                    `RagFlow 对话失败: HTTP ${response.status} ${text}`,
                );
            }

            return response;
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("RagFlow 对话失败")) {
                throw error;
            }
            const msg = this.errMsg(error);
            this.logger.warn(`RagFlow chat stream request failed: ${url}, error=${msg}`);
            throw HttpErrorFactory.badRequest(`RagFlow 对话失败: ${msg}`);
        }
    }

    /**
     * 解析 RagFlow SSE 事件块。
     *
     * @description RagFlow 的事件块形如 `data:{json}`（无 event: 行），
     * 流末尾以 `data:true`（无空格变体亦有）表示正常结束。
     */
    parseStreamEvent(rawBlock: string): RagflowStreamEvent {
        const lines = rawBlock
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        const dataLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
            }
        }

        const rawData = dataLines.join("\n");
        if (!rawData) {
            return {};
        }

        // 正常结束块：data 为字面量 true
        if (rawData === "true") {
            return { data: true, rawData };
        }

        try {
            const data = JSON.parse(rawData) as Record<string, any>;
            return {
                code: typeof data.code === "number" ? data.code : undefined,
                message: typeof data.message === "string" ? data.message : undefined,
                data: (data.data ?? data) as Record<string, any>,
                rawData,
            };
        } catch {
            return { rawData };
        }
    }

    /**
     * 从事件块中检测错误（code !== 0）。
     */
    extractError(event: RagflowStreamEvent): string | undefined {
        if (event.code !== undefined && event.code !== 0) {
            return event.message ?? `RagFlow 返回错误码 ${event.code}`;
        }
        return undefined;
    }

    /**
     * 从事件载荷中抽取增量文本。
     *
     * @description 文本增量在 `data.answer` 字段；思考开始/结束标记块的 answer 为空，自然跳过。
     */
    extractDeltaText(data?: Record<string, any> | boolean): string {
        if (!data || typeof data === "boolean") return "";
        const answer = data.answer;
        return typeof answer === "string" ? answer : "";
    }

    /**
     * 判断事件是否为推理开始/结束标记。
     */
    extractThinkSignal(data?: Record<string, any> | boolean): "start" | "end" | undefined {
        if (!data || typeof data === "boolean") return undefined;
        if (data.start_to_think === true) return "start";
        if (data.end_to_think === true) return "end";
        return undefined;
    }

    /**
     * 从事件载荷中抽取 session/chat/message 标识。
     */
    extractIdentifiers(data?: Record<string, any> | boolean): {
        sessionId?: string;
        chatId?: string;
        messageId?: string;
    } {
        if (!data || typeof data === "boolean") return {};

        return {
            sessionId: data.session_id ?? data.sessionId,
            chatId: data.chat_id ?? data.chatId,
            messageId: data.id ?? data.message_id,
        };
    }

    /**
     * 从事件载荷中抽取知识库引用块。
     */
    extractReferences(data?: Record<string, any> | boolean): RagflowReferenceChunk[] {
        if (!data || typeof data === "boolean") return [];
        const chunks = data.reference?.chunks;
        if (!Array.isArray(chunks)) return [];

        return chunks
            .filter((chunk): chunk is Record<string, any> => Boolean(chunk) && typeof chunk === "object")
            .map((chunk) => ({
                id: chunk.id ? String(chunk.id) : undefined,
                content: typeof chunk.content === "string" ? chunk.content : undefined,
                documentName:
                    chunk.document_name ?? chunk.docnm_kwd ?? chunk.document_keyword,
                datasetName: chunk.dataset_name ?? chunk.kb_name,
                similarity:
                    typeof chunk.similarity === "number"
                        ? chunk.similarity
                        : Number(chunk.similarity) || undefined,
                raw: chunk,
            }));
    }

    /**
     * 规范化 baseURL。
     *
     * @description RagFlow 的 API 前缀为 `/api/v1`；兼容直接填根地址或误填 `/v1` 的写法。
     */
    normalizeBaseUrl(baseURL?: string): string {
        const value = baseURL?.trim();
        if (!value) return this.defaultBaseUrl;

        try {
            const url = new URL(value);
            let normalized = url.toString().replace(/\/+$/, "");
            if (normalized.endsWith("/api")) {
                normalized += "/v1";
            } else if (!normalized.endsWith("/api/v1")) {
                normalized += "/api/v1";
            }
            return normalized;
        } catch {
            throw HttpErrorFactory.badRequest("RagFlow Base URL 格式不正确");
        }
    }

    private buildHeaders(apiKey: string): HeadersInit {
        return {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        };
    }

    private mapAppInfo(data: Record<string, any>): RagflowAppInfo {
        const promptConfig = (data.prompt_config ?? {}) as Record<string, any>;

        return {
            name: this.pickString(data.name),
            description: this.pickString(data.description),
            prologue: this.pickString(promptConfig.prologue),
            raw: data,
        };
    }

    private pickString(...values: unknown[]): string {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
        return "";
    }

    private errMsg(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
