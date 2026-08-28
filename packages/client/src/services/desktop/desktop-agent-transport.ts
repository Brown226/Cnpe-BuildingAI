/**
 * 桌面端本地引擎 Transport：实现 AI SDK 的 ChatTransport 接口，
 * 把 useChat 的请求改道到本机 agent-core sidecar（stdio JSON-RPC），
 * 并将 engine/event 通知流映射为 UIMessageChunk 流。
 *
 * 仅在 Tauri 桌面环境使用（isDesktop() 为 true 时由 use-chat-stream 注入）；
 * 会话正文只存在于本机 Pi 引擎进程内，不落服务端（ADR-07 本地优先）。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import { onAgentEvent, rpc } from "./desktop-api";
import { appendThreadMessages, type LocalThreadMessage } from "./thread-store";
import { useAssistantStore } from "@buildingai/stores";
import { useTodoStore, type TodoTask } from "@/components/desktop/todo-store";

/** sidecar 事件形态（对应 agent-core EngineEvent） */
interface EngineEventDto {
    type: string;
    delta?: string;
    callId?: string;
    name?: string;
    argsPreview?: string;
    ok?: boolean;
    durationMs?: number;
    message?: string;
    stopReason?: "end_turn" | "aborted" | "max_steps";
}

/** 当前回合归属（由 use-chat-stream 在发送/切换时设置） */
interface ThreadContext {
    threadId: string;
    workspaceId: string | null;
    /** 会话模式（T1.1 双模式）：code | work；首次建会话时生效 */
    mode?: "code" | "work";
    /** 智能体 persona 角色设定：首次建会话时注入 system */
    agentRole?: string;
}

/** 每个聊天线程一个本地会话；线程 id → Pi sessionId */
const sessionByChat = new Map<string, Promise<string>>();
/** 线程 id → 首次建会话时的模式（与 Pi session 固定绑定） */
const modeByChat = new Map<string, "code" | "work">();

function ensureSession(chatId: string, mode: "code" | "work"): Promise<string> {
    let p = sessionByChat.get(chatId);
    if (!p) {
        p = rpc<{ sessionId: string }>("session.create", { mode }).then((r) => r.sessionId);
        p.catch(() => sessionByChat.delete(chatId));
        sessionByChat.set(chatId, p);
        modeByChat.set(chatId, mode);
    }
    return p;
}

function extractUserText(messages: UIMessage[]): string {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (!last) return "";
    return (last.parts ?? [])
        .filter(
            (part): part is Extract<typeof part, { type: "text" }> =>
                part.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n");
}

export class DesktopAgentTransport implements ChatTransport<UIMessage> {
    /** 当前线程上下文（use-chat-stream 注入；会话持久化的归属键） */
    private threadContext: ThreadContext | null = null;

    setThreadContext(ctx: ThreadContext | null): void {
        this.threadContext = ctx;
    }

    private get chatKey(): string {
        return this.threadContext?.threadId ?? "default";
    }

    async sendMessages(options: {
        trigger: "submit-message" | "regenerate-message";
        chatId: string;
        messageId: string | undefined;
        messages: UIMessage[];
        abortSignal: AbortSignal | undefined;
    }): Promise<ReadableStream<UIMessageChunk>> {
        const text = extractUserText(options.messages);
        return new ReadableStream<UIMessageChunk>({
            start: (controller) => {
                void this.pump(controller, this.chatKey, text, options.abortSignal);
            },
            cancel: () => {
                // 下游放弃消费（组件卸载/切换会话）：中断本地引擎回合
                void this.abortOf(this.chatKey);
            },
        });
    }

    /** 断线重连不支持（进程内流不存在跨会话恢复语义） */
    async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
        return null;
    }

    private async abortOf(chatId: string): Promise<void> {
        try {
            const sid = await sessionByChat.get(chatId)!;
            await rpc("session.abort", { sessionId: sid });
        } catch {
            /* 忽略未启动场景 */
        }
    }

    /**
     * 事件泵：先订阅引擎通知再触发发送，确保首事件不丢；
     * done/error/abort 时收尾关闭流。
     */
    private async pump(
        controller: ReadableStreamDefaultController<UIMessageChunk>,
        chatId: string,
        text: string,
        abortSignal: AbortSignal | undefined,
    ): Promise<void> {
        let aborted = false;
        let finished = false;
        let unlisten: (() => void) | undefined;

        const close = (): void => {
            if (finished) return;
            finished = true;
            unlisten?.();
            try {
                controller.close();
            } catch {
                /* 已被 cancel 关闭 */
            }
        };

        try {
            let sid: string;
            try {
                const mode = this.threadContext?.mode ?? modeByChat.get(chatId) ?? "code";
                sid = await ensureSession(chatId, mode);
            } catch (err) {
                controller.enqueue({
                    type: "error",
                    errorText: `本地智能引擎未就绪：${String(err)}`,
                });
                close();
                return;
            }

            // 会话持久化累计器（轻量文本流，工具调用记摘要行）
            const threadMessages: LocalThreadMessage[] = [{ role: "user", text }];
            let assistantText = "";
            let toolSummary = "";

            // 单步渲染整轮回合（工具循环在内）
            controller.enqueue({ type: "start", messageId: crypto.randomUUID() });
            controller.enqueue({ type: "start-step" });

            let openTextId: string | null = null;
            let openReasoningId: string | null = null;
            let textOpenedEver = false;
            let toolSeq = 0;
            let errorText: string | undefined;
            let stopAborted = false;

            const endOpen = (): void => {
                if (openTextId) {
                    controller.enqueue({ type: "text-end", id: openTextId });
                    openTextId = null;
                }
                if (openReasoningId) {
                    controller.enqueue({ type: "reasoning-end", id: openReasoningId });
                    openReasoningId = null;
                }
            };

            unlisten = await onAgentEvent((frame) => {
                if (frame.method !== "engine/event" || finished) return;
                const params = frame.params ?? {};
                if (params.sessionId && params.sessionId !== sid) return; // 其他线程事件
                const ev = params.event as EngineEventDto | undefined;
                if (!ev) return;

                switch (ev.type) {
                    case "thinking_delta": {
                        if (!openReasoningId) {
                            openReasoningId = crypto.randomUUID();
                            controller.enqueue({
                                type: "reasoning-start",
                                id: openReasoningId,
                            });
                        }
                        controller.enqueue({
                            type: "reasoning-delta",
                            id: openReasoningId,
                            delta: ev.delta ?? "",
                        });
                        break;
                    }
                    case "text_delta": {
                        if (!openTextId) {
                            openTextId = crypto.randomUUID();
                            textOpenedEver = true;
                            controller.enqueue({ type: "text-start", id: openTextId });
                        }
                        controller.enqueue({
                            type: "text-delta",
                            id: openTextId,
                            delta: ev.delta ?? "",
                        });
                        assistantText += ev.delta ?? "";
                        break;
                    }
                    case "tool_call_start": {
                        endOpen();
                        toolSeq += 1;
                        const callId = ev.callId ?? `tool-${toolSeq}`;
                        controller.enqueue({
                            type: "tool-input-available",
                            toolCallId: callId,
                            toolName: ev.name || "tool",
                            input: { preview: ev.argsPreview ?? "" },
                            dynamic: true,
                            title: "执行工具",
                        });
                        break;
                    }
                    case "tool_call_end": {
                        toolSummary += `\n[工具 ${ev.name ?? "tool"} ${ev.ok ? "完成" : "失败"} · ${ev.durationMs ?? 0}ms]`;
                        const output =
                            typeof ev.resultPreview === "string"
                                ? { summary: ev.resultPreview.slice(0, 2000) }
                                : { summary: `${ev.ok ? "完成" : "失败"}（${ev.durationMs ?? 0}ms）` };
                        controller.enqueue({
                            type: "tool-output-available",
                            toolCallId: ev.callId ?? `tool-${toolSeq}`,
                            output,
                        });
                        // ② Todo Tab：todo 扩展每次调用的结果携带全量任务快照
                        if (ev.name === "todo" && typeof ev.resultPreview === "string") {
                            try {
                                const parsed = JSON.parse(ev.resultPreview) as {
                                    details?: { tasks?: TodoTask[] };
                                };
                                if (Array.isArray(parsed?.details?.tasks)) {
                                    useTodoStore
                                        .getState()
                                        .applyTodoSnapshot(chatId, parsed.details.tasks);
                                }
                            } catch {
                                /* 非 todo 快照或截断，忽略 */
                            }
                        }
                        break;
                    }
                    case "usage": {
                        // T1.2 缓存可观测 + T4.6 计量上报 + ①-4 用量历史展示
                        const u = ev as unknown as {
                            inputTokens?: number;
                            outputTokens?: number;
                            cacheReadTokens?: number;
                            cacheWriteTokens?: number;
                        };
                        useAssistantStore.getState().recordSessionUsage({
                            inputTokens: u.inputTokens ?? 0,
                            outputTokens: u.outputTokens ?? 0,
                            cacheReadTokens: u.cacheReadTokens ?? 0,
                        });
                        break;
                    }
                    case "error": {
                        errorText = ev.message;
                        break;
                    }
                    case "done": {
                        if (ev.stopReason === "aborted") stopAborted = true;
                        endOpen();
                        if (stopAborted) {
                            controller.enqueue({ type: "abort", reason: "用户中止" });
                        } else if (errorText) {
                            controller.enqueue({ type: "error", errorText });
                            controller.enqueue({ type: "finish-step" });
                            controller.enqueue({ type: "finish", finishReason: "stop" });
                        } else {
                            controller.enqueue({ type: "finish-step" });
                            controller.enqueue({ type: "finish", finishReason: "stop" });
                        }
                        // 持久化本轮轻量文本流（供「项目」侧栏与历史回放）
                        if (this.threadContext) {
                            const msgs = [...threadMessages];
                            const full =
                                assistantText +
                                (toolSummary.trim() ? `\n${toolSummary.trim()}` : "");
                            if (full.trim()) msgs.push({ role: "assistant", text: full });
                            appendThreadMessages(
                                chatId,
                                this.threadContext.workspaceId,
                                msgs,
                                text,
                                this.threadContext.mode ?? "code",
                            );
                        }
                        close();
                        break;
                    }
                    default:
                        break;
                }
            });

            // 手动停止按钮触发的 AbortSignal
            abortSignal?.addEventListener(
                "abort",
                () => {
                    aborted = true;
                    void rpc("session.abort", { sessionId: sid }).catch(() => undefined);
                },
                { once: true },
            );

            const mode = this.threadContext?.mode ?? modeByChat.get(chatId) ?? "code";
            const agentRole = this.threadContext?.agentRole;
            // ⑤ 知识库挂载：输入条选择器当前所选数据集随每轮下发（会话级挂载）
            const datasetIds = useAssistantStore.getState().composerDatasetIds;
            await rpc("session.send", {
                sessionId: sid,
                text,
                mode,
                agentRole,
                ...(datasetIds.length > 0 ? { datasetIds } : {}),
            });
            // aborted 场景下 done 可能仍随后到达，但流已通过 abort 块关闭
            if (aborted) {
                /* 等待引擎侧 done/abort 收尾；超时兜底 */
                setTimeout(() => {
                    endOpen();
                    controller.enqueue({ type: "abort", reason: "已中止" });
                    close();
                }, 3000);
            }
        } catch (err) {
            controller.enqueue({ type: "error", errorText: String(err) });
            close();
        }
    }
}

/** 进程级单例：同一线程复用同一 sidecar 会话与订阅 */
let singleton: DesktopAgentTransport | null = null;

export function getDesktopAgentTransport(): DesktopAgentTransport {
    singleton ??= new DesktopAgentTransport();
    return singleton;
}
