import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { logStderr } from "../protocol/server.js";
import type { AgentEngine, EngineEvent, EngineStartConfig, ModelRef, UserInput } from "./types.js";
import type { PlatformTool } from "../tools/types.js";
import { toPiTools } from "./platform-tool-adapter.js";

/** 会话运行时：pi session + 事件泵 + 挂起 resolve */
interface LiveSession {
    sessionId: string;
    session: AgentSession;
    cwd: string;
    agentDir: string;
    unsub: () => void;
}

const PLATFORM_SYSTEM_PROMPT = [
    "你是华数智能平台的桌面办公与编程助手，运行在员工本机。",
    "你通过平台提供的工具读写工作区文件、执行命令、处理文档；",
    "所有操作都受企业安全策略约束，被拒绝时向用户解释原因即可，不要重试被明确拒绝的操作。",
].join("\n");

/**
 * Pi 引擎实现（ADR-02）：把 @earendil-works/pi-coding-agent 装进
 * AgentEngine 四原语接口。模型接入经 OpenAI 兼容自定义 provider；
 * 开发期直连 .env.local 端点，生产期同一通道指向服务端网关。
 */
export class PiEngine implements AgentEngine {
    readonly name = "pi";

    private runtime: ModelRuntime | null = null;
    private model: Model<Api> | null = null;
    private tools: PlatformTool[] = [];
    private sessions = new Map<string, LiveSession>();
    private startConfig: EngineStartConfig | null = null;
    /** 每个会话的待推送事件队列（AsyncIterable 支持慢消费） */
    private queues = new Map<string, EngineEvent[]>();
    private resolvers = new Map<string, (() => void)[]>();
    private providerId = "huashu-gateway";
    private tempFiles: string[] = [];
    /** start() 解析出的最终上游地址（网关或开发端点） */
    private resolvedBaseUrl = "";

    async start(config: EngineStartConfig): Promise<void> {
        this.startConfig = config;
        // 网关模式（生产）：modelGatewayUrl 来自服务端下发的配置包，凭据为登录态短期 token；
        // 开发模式：未传网关地址时退回 .env.local 直连端点
        const baseUrl = config.modelGatewayUrl || process.env.DEV_MODEL_BASE_URL;
        const apiKey = config.gatewayToken || process.env.DEV_MODEL_API_KEY;
        if (!baseUrl || !apiKey) {
            throw new Error(
                "缺少模型接入配置：需要 modelGatewayUrl/gatewayToken（网关模式）或 DEV_MODEL_BASE_URL/DEV_MODEL_API_KEY（开发直连）",
            );
        }
        const modelId = config.defaultModel?.modelId ?? process.env.DEV_MODEL_ID ?? "gpt-5.6-sol";
        this.resolvedBaseUrl = baseUrl;

        // models.json 让 runtime 的 provider 注册表认识自定义 provider
        const modelsPath = await this.writeModelsJson(baseUrl, modelId);
        this.tempFiles.push(modelsPath);

        this.runtime = await ModelRuntime.create({
            credentials: new InMemoryCredentialStore(),
            modelsPath,
        });
        await this.runtime.setRuntimeApiKey(this.providerId, apiKey);
        logStderr(`PiEngine 已启动：provider=${this.providerId} baseUrl=${baseUrl}`);
    }

    registerTools(tools: PlatformTool[]): void {
        this.tools = [...tools];
        // 后注册的工具同步进已存在的会话不可行——重启会话才生效；当前为可接受语义
    }

    /**
     * 发送用户消息并返回事件流。
     * 关键实现细节：async generator 函数体是惰性执行的——若在此方法体内
     * 订阅事件/启动 prompt，消费方首次 next 前什么都不会发生；而 drain
     * 循环又会等待事件，形成死锁。因此这里拆成两段：
     * ① 同步立即启动回合（beginTurn），② 返回纯队列迭代器。
     */
    sendMessage(sessionId: string, input: UserInput): AsyncIterable<EngineEvent> {
        const turnPromise = this.beginTurn(sessionId, input);
        const engine = this;
        return {
            [Symbol.asyncIterator]() {
                return engine.iterateTurn(sessionId, turnPromise);
            },
        };
    }

    /** 回合启动：建订阅 → 启动 prompt（不 await 完成即返回） */
    private async beginTurn(sessionId: string, input: UserInput): Promise<void> {
        try {
            const live = await this.ensureSession(sessionId);
            const queue = this.getQueue(sessionId);
            const push = (event: EngineEvent): void => {
                queue.push(event);
                this.wake(sessionId);
            };

            live.unsub();
            let stepToolCalls = new Map<string, { name: string; startedAt: number; ok: boolean }>();
            const unsub = live.session.subscribe((event: Record<string, any>) => {
                switch (event.type) {
                    case "message_update": {
                        const ame = event.assistantMessageEvent as Record<string, any> | undefined;
                        if (!ame) break;
                        if (ame.type === "text_delta" && typeof ame.delta === "string")
                            push({ type: "text_delta", delta: ame.delta });
                        else if (ame.type === "thinking_delta" && typeof ame.delta === "string")
                            push({ type: "thinking_delta", delta: ame.delta });
                        else if (ame.type === "toolcall_start")
                            stepToolCalls.set(String(ame.contentIndex ?? "0"), {
                                name: "?",
                                startedAt: Date.now(),
                                ok: false,
                            });
                        else if (ame.type === "toolcall_end") {
                            const idx = String(ame.contentIndex ?? "0");
                            const started = stepToolCalls.get(idx)?.startedAt;
                            stepToolCalls.set(idx, {
                                name: String(ame.toolCall?.name ?? "tool"),
                                startedAt: started ?? Date.now(),
                                ok: true,
                            });
                        }
                        break;
                    }
                    case "message_end": {
                        const message = event.message as Record<string, any> | undefined;
                        if (message?.role !== "assistant") break;
                        for (const [, call] of stepToolCalls)
                            push({
                                type: "tool_call_end",
                                callId: `${call.name}-${call.startedAt}`,
                                ok: call.ok,
                                durationMs: Date.now() - call.startedAt,
                            });
                        stepToolCalls = new Map();
                        const usage = message.usage as Record<string, number> | undefined;
                        if (usage)
                            push({
                                type: "usage",
                                inputTokens: usage.input ?? usage.promptTokens ?? 0,
                                outputTokens: usage.output ?? usage.completionTokens ?? 0,
                            });
                        break;
                    }
                    default:
                        break;
                }
            });
            live.unsub = () => unsub();

            try {
                await live.session.prompt(input.text);
                push({ type: "done", stopReason: "end_turn" });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logStderr(`PiEngine 会话 ${sessionId} 推理失败: ${message}`);
                push({ type: "error", message, recoverable: true });
                push({ type: "done", stopReason: "aborted" });
            }
        } catch (setupErr) {
            // 会话构建失败（引擎未就绪/模型端点不可达）也要终止消费方的 drain
            const q = this.getQueue(sessionId);
            q.push({
                type: "error",
                message: setupErr instanceof Error ? setupErr.message : String(setupErr),
                recoverable: false,
            });
            q.push({ type: "done", stopReason: "aborted" });
            this.wake(sessionId);
        }
    }

    /** 纯队列迭代器：产出事件直到 done/error 终止 */
    private async *iterateTurn(
        sessionId: string,
        turnPromise: Promise<void>,
    ): AsyncGenerator<EngineEvent> {
        while (true) {
            const q = this.getQueue(sessionId);
            const terminalIdx = q.findIndex((e) => e.type === "done" || e.type === "error");
            if (terminalIdx >= 0) {
                for (let i = 0; i <= terminalIdx; i++) yield q[i]!;
                q.splice(0, terminalIdx + 1);
                return;
            }
            if (q.length > 0) {
                yield* q.splice(0, q.length);
                continue;
            }
            // 队列空：等新事件或回合整体失败
            const wakePromise = new Promise<void>((resolve) => {
                const list = this.resolvers.get(sessionId) ?? [];
                list.push(resolve);
                this.resolvers.set(sessionId, list);
            });
            const raceGuard = turnPromise.then(() => false);
            void raceGuard.catch(() => undefined);
            await Promise.race([wakePromise]);
            // beginTurn 自身捕获全部异常并注入 done/error，无需额外处理
        }
    }

    abort(sessionId: string): void {
        const live = this.sessions.get(sessionId);
        if (!live) return;
        void live.session.abort().catch(() => undefined);
    }

    async dispose(): Promise<void> {
        for (const [, live] of this.sessions) {
            try {
                live.unsub();
                void live.session.abort().catch(() => undefined);
            } catch {
                /* 忽略停机异常 */
            }
        }
        this.sessions.clear();
        for (const f of this.tempFiles) {
            try {
                rmSync(f, { force: true });
            } catch {
                /* 临时文件清理失败可忽略 */
            }
        }
        this.tempFiles = [];
    }

    // ── 内部 ───────────────────────────────────────────────────────────

    private async writeModelsJson(baseUrl: string, modelId: string): Promise<string> {
        const payload = {
            providers: {
                [this.providerId]: {
                    name: "华数模型网关",
                    baseUrl,
                    api: "openai-completions",
                    models: [
                        {
                            id: modelId,
                            name: modelId,
                            reasoning: false,
                            input: ["text"],
                            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                            contextWindow: 128_000,
                            maxTokens: 8_192,
                        },
                    ],
                },
            },
        };
        const dir = mkdtempSync(join(tmpdir(), "agent-core-models-"));
        const file = join(dir, "models.json");
        await writeFile(file, JSON.stringify(payload), "utf8");
        return file;
    }

    private buildModelObject(modelId: string): Model<Api> {
        return {
            id: modelId,
            name: modelId,
            provider: this.providerId,
            api: "openai-completions",
            baseUrl: this.resolvedBaseUrl,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 8_192,
        } as unknown as Model<Api>;
    }

    private async ensureSession(sessionId: string): Promise<LiveSession> {
        const existing = this.sessions.get(sessionId);
        if (existing) return existing;
        if (!this.runtime || !this.startConfig)
            throw new Error("engine.start() 尚未调用");

        const config = this.startConfig;
        const modelId =
            config.defaultModel?.modelId ?? process.env.DEV_MODEL_ID ?? "gpt-5.6-sol";
        // cwd 取会话主工作区：无白名单时退化为临时目录且工具仍然受策略管控
        const workspaceRoot = process.env.AGENT_CORE_WORKSPACE ?? mkdtempSync(join(tmpdir(), `session-${sessionId.slice(0, 8)}-`));
        const cwd = workspaceRoot!;
        const agentDir = mkdtempSync(join(tmpdir(), `agent-dir-${randomUUID().slice(0, 8)}-`));

        const resourceLoader = new DefaultResourceLoader({
            cwd,
            agentDir,
            systemPrompt: PLATFORM_SYSTEM_PROMPT,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
        });
        await resourceLoader.reload();

        const { session } = await createAgentSession({
            model: this.buildModelObject(modelId),
            modelRuntime: this.runtime,
            resourceLoader,
            customTools: toPiTools(this.tools),
            noTools: "builtin",
            sessionManager: SessionManager.inMemory(),
            cwd,
            agentDir,
        });

        const live: LiveSession = {
            sessionId,
            session,
            cwd,
            agentDir,
            unsub: () => undefined,
        };
        this.sessions.set(sessionId, live);
        return live;
    }

    private getQueue(sessionId: string): EngineEvent[] {
        let q = this.queues.get(sessionId);
        if (!q) {
            q = [];
            this.queues.set(sessionId, q);
        }
        return q;
    }

    private wake(sessionId: string): void {
        const rs = this.resolvers.get(sessionId);
        this.resolvers.set(sessionId, []);
        for (const r of rs ?? []) r();
    }
}
