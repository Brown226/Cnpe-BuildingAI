import { extractTextFromParts } from "@buildingai/ai-sdk/utils/token-usage";
import {
    type DocumentContent,
    parseFile,
    processFiles as processFilesUtil,
    type ProcessFilesWriter,
} from "@buildingai/ai-toolkit/utils";
import type { Agent } from "@buildingai/db/entities";
import { HttpErrorFactory } from "@buildingai/errors";
import type { ChatUIMessage } from "@buildingai/types";
import { AgentConfigService } from "@modules/config/services/agent-config.service";
import { Injectable, Logger } from "@nestjs/common";
import {
    createUIMessageStream,
    generateId,
    pipeUIMessageStreamToResponse,
    type UIMessage,
} from "ai";
import type { ServerResponse } from "http";
import { validate as isUUID } from "uuid";

import { AgentBillingHandler } from "../handlers/agent-billing";
import {
    RagflowApiService,
    RagflowReferenceChunk,
    type RagflowChatUsage,
} from "../integrations/ragflow-api.service";
import type { AgentChatCompletionParams } from "../services/agent-chat-completion.service";
import { AgentChatMessageService } from "../services/agent-chat-message.service";
import { AgentChatRecordService } from "../services/agent-chat-record.service";

type ProviderWriter = {
    write: (part: Record<string, any>) => void;
};

/**
 * RagFlow 聊天助手 Provider。
 *
 * @description
 * 通过「创建会话时绑定 user_id」实现上游用户隔离：
 * 本地会话首轮对话时在 RagFlow 创建 session（user_id = 平台用户 ID），
 * 后续对话携带 session_id，RagFlow 侧会话归属即按平台用户隔离。
 */
@Injectable()
export class RagflowChatProvider {
    private readonly logger = new Logger(RagflowChatProvider.name);

    constructor(
        private readonly ragflowApiService: RagflowApiService,
        private readonly agentChatRecordService: AgentChatRecordService,
        private readonly agentChatMessageService: AgentChatMessageService,
        private readonly agentBillingHandler: AgentBillingHandler,
        private readonly agentConfigService: AgentConfigService,
    ) {}

    /**
     * 处理 RagFlow 流式对话。
     */
    async streamChat(
        agent: Agent,
        params: AgentChatCompletionParams,
        response: ServerResponse,
    ): Promise<void> {
        const saveConversation = params.saveConversation !== false;
        let localConversationId = saveConversation
            ? await this.resolveLocalConversationId(params)
            : undefined;
        const lastUserMessage = params.messages.findLast((message) => message.role === "user");
        const initialTitle = lastUserMessage
            ? extractTextFromParts(lastUserMessage.parts ?? []).fullText
            : "";

        if (saveConversation && !localConversationId) {
            const record = await this.agentChatRecordService.createConversation({
                agentId: params.agentId,
                userId: params.userId,
                anonymousIdentifier: params.anonymousIdentifier,
                title: initialTitle,
            });
            localConversationId = record.id;
        }

        const stream = createUIMessageStream({
            execute: async ({ writer }) => {
                if (localConversationId) {
                    writer.write({
                        type: "data-conversation-id",
                        data: localConversationId,
                        transient: true,
                    } as any);
                }

                const assistantMessageId = generateId();
                writer.write({ type: "start", messageId: assistantMessageId });
                writer.write({ type: "start-step" });

                const { messages: processedMessages, documentContents } = await processFilesUtil(
                    params.messages,
                    writer as unknown as ProcessFilesWriter,
                    parseFile,
                );

                const lastUser = processedMessages.findLast((message) => message.role === "user");
                let question = lastUser ? extractTextFromParts(lastUser.parts ?? []).fullText : "";
                if (documentContents.length > 0) {
                    question = this.appendDocumentContents(question, documentContents);
                }

                if (!question.trim()) {
                    throw HttpErrorFactory.badRequest("RagFlow 对话内容不能为空");
                }

                // 解析远端 session：优先复用本地会话绑定的 session_id；
                // 首轮对话则在 RagFlow 创建会话并绑定平台用户 ID（隔离关键步骤）
                let ragflowSessionId = await this.resolveRemoteSessionId(
                    agent,
                    localConversationId,
                );
                if (!ragflowSessionId && localConversationId) {
                    const session = await this.ragflowApiService.createSession(
                        agent.thirdPartyIntegration,
                        { userId: params.userId ?? "", name: initialTitle.slice(0, 60) },
                    );
                    ragflowSessionId = session.id;
                }

                const billingRule = await this.getBillingRule();
                const shouldCharge = params.isDebug !== true;
                if (shouldCharge && params.userId && billingRule) {
                    await this.agentBillingHandler.validateUserPower(params.userId, billingRule);
                }

                const ragflowResponse = await this.ragflowApiService.streamChat({
                    config: agent.thirdPartyIntegration,
                    userId: params.userId,
                    question,
                    sessionId: ragflowSessionId,
                });

                const reader = ragflowResponse.body?.getReader();
                if (!reader) {
                    throw HttpErrorFactory.badRequest("RagFlow 未返回可读流");
                }

                const decoder = new TextDecoder();
                let buffer = "";
                let fullText = "";
                let usage: RagflowChatUsage | undefined;
                let references: RagflowReferenceChunk[] = [];
                /** 当前文本分段 id；思考与回答分为不同 text part */
                let textIndex = 0;
                let textStarted = false;
                let inThink = false;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value) continue;

                    buffer += decoder.decode(value, { stream: true });
                    const chunks = buffer.split(/\n\n+/);
                    buffer = chunks.pop() ?? "";

                    for (const chunk of chunks) {
                        const parsed = this.ragflowApiService.parseStreamEvent(chunk);

                        // ---- 错误检测 ----
                        const errorMsg = this.ragflowApiService.extractError(parsed);
                        if (errorMsg) {
                            throw HttpErrorFactory.badRequest(`RagFlow 错误: ${errorMsg}`);
                        }

                        // ---- 标识提取 ----
                        const identifiers = this.ragflowApiService.extractIdentifiers(parsed.data);
                        ragflowSessionId = identifiers.sessionId ?? ragflowSessionId;

                        // ---- 思考开始/结束：切换文本分段 ----
                        const thinkSignal = this.ragflowApiService.extractThinkSignal(parsed.data);
                        if (thinkSignal && textStarted) {
                            writer.write({ type: "text-end", id: `txt-${textIndex}` });
                            textStarted = false;
                            inThink = thinkSignal === "start";
                        } else if (thinkSignal === "start") {
                            inThink = true;
                        } else if (thinkSignal === "end") {
                            inThink = false;
                        }

                        // ---- 引用块 ----
                        const chunkRefs = this.ragflowApiService.extractReferences(parsed.data);
                        if (chunkRefs.length > 0) {
                            references = chunkRefs;
                        }

                        // ---- 文本 delta ----
                        const deltaText = this.ragflowApiService.extractDeltaText(parsed.data);
                        if (deltaText) {
                            if (!textStarted) {
                                textIndex += 1;
                                writer.write({ type: "text-start", id: `txt-${textIndex}` });
                                textStarted = true;
                            }
                            fullText += deltaText;
                            writer.write({
                                type: "text-delta",
                                id: `txt-${textIndex}`,
                                delta: deltaText,
                                ...(inThink ? { metadata: { reasoning: true } } : {}),
                            });
                        }
                    }
                }

                // 确保 text-start / text-end 配对
                if (!textStarted) {
                    writer.write({ type: "text-start", id: `txt-${textIndex + 1}` });
                }
                writer.write({ type: "text-end", id: textStarted ? `txt-${textIndex}` : `txt-${textIndex + 1}` });
                writer.write({ type: "finish-step" });
                writer.write({ type: "finish", finishReason: "stop" });

                let userConsumedPower = 0;
                if (
                    shouldCharge &&
                    saveConversation &&
                    localConversationId &&
                    params.userId &&
                    billingRule &&
                    usage
                ) {
                    userConsumedPower = await this.agentBillingHandler.deduct({
                        userId: params.userId,
                        conversationId: localConversationId,
                        usage,
                        billingRule,
                    });
                }
                writer.write({
                    type: "data-usage",
                    data: {
                        inputTokens: usage?.inputTokens ?? 0,
                        outputTokens: usage?.outputTokens ?? 0,
                        totalTokens: usage?.totalTokens ?? 0,
                        raw: {
                            prompt_tokens: usage?.inputTokens ?? 0,
                            completion_tokens: usage?.outputTokens ?? 0,
                            total_tokens: usage?.totalTokens ?? 0,
                        },
                        userConsumedPower,
                    },
                });

                const responseMessage: UIMessage = {
                    id: assistantMessageId,
                    role: "assistant",
                    parts:
                        fullText.length > 0
                            ? [{ type: "text", text: fullText }]
                            : [],
                };
                const finished = [...params.messages, responseMessage];
                writer.write({
                    type: "data-conversation-context",
                    data: {
                        messageId: assistantMessageId,
                        messages: finished.map((message) => ({
                            role: message.role,
                            content:
                                extractTextFromParts(message.parts ?? []).fullText ||
                                "(无文本内容)",
                        })),
                    },
                });

                if (localConversationId) {
                    await this.agentChatRecordService.updateMetadata(localConversationId, {
                        provider: "ragflow",
                        ragflowSessionId,
                        ragflowReferences: references,
                    });
                    await this.saveMessages({
                        conversationId: localConversationId,
                        params,
                        writer,
                        lastUser,
                        responseMessage,
                        usage,
                        userConsumedPower,
                        metadata: {
                            provider: "ragflow",
                            ragflowSessionId,
                            ragflowReferences: references,
                        },
                    });
                }
            },
            onError: (error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.error(`RagFlow chat stream error: ${message}`);
                return message;
            },
        });

        pipeUIMessageStreamToResponse({ stream, response });
    }

    private async resolveLocalConversationId(
        params: AgentChatCompletionParams,
    ): Promise<string | undefined> {
        const requestedConversationId = params.conversationId;
        if (!requestedConversationId) {
            return undefined;
        }

        if (isUUID(requestedConversationId)) {
            return requestedConversationId;
        }

        const record = await this.agentChatRecordService.findConversationByRagflowSessionId({
            agentId: params.agentId,
            userId: params.userId,
            ragflowSessionId: requestedConversationId,
        });
        if (record?.id) {
            this.logger.warn(
                `Received remote RagFlow session id as local conversationId, remapped to local record: ${requestedConversationId} -> ${record.id}`,
            );
            return record.id;
        }

        this.logger.warn(
            `Received non-UUID conversationId but no local record was found, a new local conversation will be created: ${requestedConversationId}`,
        );
        return undefined;
    }

    private async resolveRemoteSessionId(
        agent: Agent,
        localConversationId?: string,
    ): Promise<string | undefined> {
        if (agent.thirdPartyIntegration?.useExternalConversation === false) {
            return undefined;
        }
        if (!localConversationId) {
            return undefined;
        }

        const record = await this.agentChatRecordService.getConversation(localConversationId);
        const sessionId = record?.metadata?.ragflowSessionId;
        return typeof sessionId === "string" ? sessionId : undefined;
    }

    private async saveMessages(params: {
        conversationId: string;
        params: AgentChatCompletionParams;
        writer: ProviderWriter;
        lastUser?: UIMessage;
        responseMessage: UIMessage;
        usage?: RagflowChatUsage;
        userConsumedPower?: number;
        metadata?: Record<string, any>;
    }): Promise<void> {
        const {
            conversationId,
            params: chatParams,
            writer,
            lastUser,
            responseMessage,
            usage,
            userConsumedPower,
            metadata,
        } = params;
        const safeConversationId = isUUID(conversationId)
            ? conversationId
            : (
                  await this.agentChatRecordService.findConversationByRagflowSessionId({
                      agentId: chatParams.agentId,
                      userId: chatParams.userId,
                      ragflowSessionId: conversationId,
                  })
              )?.id;

        if (!safeConversationId) {
            throw HttpErrorFactory.badRequest("RagFlow 本地会话不存在，无法保存消息");
        }

        let userMessageId: string | undefined;
        if (chatParams.isRegenerate) {
            userMessageId = chatParams.regenerateParentId;
        } else if (lastUser) {
            const savedUserMessage = await this.agentChatMessageService.createMessage({
                conversationId: safeConversationId,
                agentId: chatParams.agentId,
                userId: chatParams.userId,
                message: lastUser,
                formVariables: chatParams.formVariables,
                formFieldsInputs: chatParams.formFieldsInputs,
                parentId: chatParams.parentId,
            });
            userMessageId = savedUserMessage.id;
            writer.write({ type: "data-user-message-id", data: savedUserMessage.id });
        }

        const savedAssistantMessage = await this.agentChatMessageService.createMessage({
            conversationId: safeConversationId,
            agentId: chatParams.agentId,
            userId: chatParams.userId,
            message: {
                ...(responseMessage as ChatUIMessage),
                ...(usage ? { usage } : {}),
                ...(userConsumedPower != null ? { userConsumedPower } : {}),
            } as ChatUIMessage,
            parentId: userMessageId,
        });

        writer.write({
            type: "data-assistant-message-id",
            data: savedAssistantMessage.id,
        });
        await this.agentChatRecordService.updateStats(safeConversationId);
        void metadata;
    }

    private async getBillingRule(): Promise<{ power: number; tokens: number } | undefined> {
        const config = await this.agentConfigService.getConfig();
        const item = config.createTypes.find((current) => current.key === "ragflow");
        if (!item?.enabled || item.billingMode !== "points") {
            return undefined;
        }

        const points = Math.max(0, Number(item.points ?? 0) || 0);
        if (points <= 0) {
            return undefined;
        }

        return {
            power: points,
            tokens: 1000,
        };
    }

    /**
     * Append parsed document contents to the question text.
     * Truncates per-document to avoid exceeding third-party length limits.
     */
    private appendDocumentContents(question: string, documents: DocumentContent[]): string {
        const MAX_CHARS_PER_DOC = 30_000;
        const parts = documents.map((doc) => {
            const content =
                doc.content.length > MAX_CHARS_PER_DOC
                    ? doc.content.slice(0, MAX_CHARS_PER_DOC) + "\n...(truncated)"
                    : doc.content;
            return `<document name="${doc.filename}">\n${content}\n</document>`;
        });
        return `${question}\n\n[Attached Documents]\n${parts.join("\n\n")}`;
    }
}
