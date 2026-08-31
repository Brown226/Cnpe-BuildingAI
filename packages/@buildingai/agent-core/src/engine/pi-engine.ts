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
import type { AgentEngine, AgentMode, EngineEvent, EngineStartConfig, ModelRef, UserInput } from "./types.js";
import type { PlatformTool } from "../tools/types.js";
import { toPiTools } from "./platform-tool-adapter.js";
import { fingerprintPrefix, PrefixFingerprintTracker } from "./prefix-fingerprint.js";
import { ErrorCircuitBreaker } from "./error-breaker.js";

/** 会话运行时：pi session + 事件泵 + 挂起 resolve */
interface LiveSession {
    sessionId: string;
    session: AgentSession;
    cwd: string;
    agentDir: string;
    unsub: () => void;
    mode: AgentMode;
}

const PLATFORM_SYSTEM_PROMPT = [
    "你是华数智能平台的桌面办公与编程助手，运行在员工本机。",
    "你通过平台提供的工具读写工作区文件、执行命令、处理文档；",
    "所有操作都受企业安全策略约束，被拒绝时向用户解释原因即可，不要重试被明确拒绝的操作。",
].join("\n");

/**
 * 模式指令表（T1.1 双模式框架）。
 * 经 resourceLoader.appendSystemPrompt 作为第二 system 消息注入（Kun 式：
 * 模式指令位于稳定前缀之后、动态数据之前），让模型在每轮请求中明确当前任务上下文。
 */
const MODE_INSTRUCTIONS: Record<AgentMode, string> = {
    code: [
        "【当前模式：Code 编程模式】",
        "你正在协助用户完成软件开发任务：阅读与修改代码、运行命令与测试、检查 Git 变更。",
        "优先使用文件/命令工具直接完成任务；改动前先理解相关代码，完成后提示用户审查 diff。",
    ].join("\n"),
    work: [
        "【当前模式：Work 办公模式】",
        "你正在协助用户完成办公任务：撰写与整理文档、分析表格、生成报告与演示材料。",
        "优先使用文档/表格工具处理 Office 文件；生成正式交付物（docx/xlsx/pptx）时告知用户保存位置。",
    ].join("\n"),
};

/**
 * Pi 引擎实现（ADR-02）：把 @earendil-works/pi-coding-agent 装进
 * AgentEngine 四原语接口。模型接入经 OpenAI 兼容自定义 provider；
 * 开发期直连 .env.local 端点，生产期同一通道指向服务端网关。
 */
/**
 * Y3 总结阶段指令（借鉴 Yan-Agent 最终总结独立阶段）：
 * 工作阶段完成后以无工具约束的收尾请求生成交付文本，
 * 只依据已验证的工具结果与工作区事实，不复述执行过程。
 */
const SUMMARY_INSTRUCTION = [
    "【交付总结】以上任务的工作阶段已完成。请基于已执行工具的结果与工作区中的事实，",
    "输出面向用户的最终交付总结：完成了什么、关键产物与位置、未尽事项与建议。",
    "要求：不要调用任何工具；不要复述执行过程；直接给出交付内容。",
].join("");

export class PiEngine implements AgentEngine {
    readonly name = "pi";

    private runtime: ModelRuntime | null = null;
    private model: Model<Api> | null = null;
    private tools: PlatformTool[] = [];
    private sessions = new Map<string, LiveSession>();
    /** 会话级模型覆盖（模型选择器生效：切模型=该会话重建，Kun 同款"换模型开新上下文"语义） */
    private modelOverrides = new Map<string, string>();
    private startConfig: EngineStartConfig | null = null;
    /** 每个会话的待推送事件队列（AsyncIterable 支持慢消费） */
    private queues = new Map<string, EngineEvent[]>();
    private resolvers = new Map<string, (() => void)[]>();
    private providerId = "huashu-gateway";
    private tempFiles: string[] = [];
    /** start() 解析出的最终上游地址（网关或开发端点） */
    private resolvedBaseUrl = "";
    /** T1.2 前缀指纹：按模式跟踪不可变前缀基准，每回合校验漂移 */
    private fingerprints = new PrefixFingerprintTracker();
    /** Y1 重复错误熔断：同一会话同类错误连续 3 次即标记不可恢复，停止自动重试 */
    private breaker = new ErrorCircuitBreaker(3);

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
        // 工具注册变化 → 前缀变化：清空指纹基准，下一回合重建（避免误报漂移）
        this.fingerprints = new PrefixFingerprintTracker();
        // 后注册的工具同步进已存在的会话不可行——重启会话才生效；当前为可接受语义
    }

    /** T1.2：校验当前前缀指纹，漂移时告警并重建基准（返回基准是否稳定） */
    private verifyPrefix(mode: AgentMode): void {
        const fp = fingerprintPrefix({
            systemPrompt: PLATFORM_SYSTEM_PROMPT,
            appendSystemPrompt: [MODE_INSTRUCTIONS[mode]],
            tools: this.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            })),
        });
        if (!this.fingerprints.verify(mode, fp)) {
            logStderr(
                `[cache] 前缀指纹漂移（mode=${mode}）——缓存命中率将下降；` +
                    `可能是工具列表或系统提示发生变化，已重建基准`,
            );
            this.fingerprints.rebaseline(mode, fp);
        }
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
            const mode = input.mode ?? "code";
            this.verifyPrefix(mode);
            const live = await this.ensureSession(sessionId, mode, input.agentRole);
            const queue = this.getQueue(sessionId);
            const push = (event: EngineEvent): void => {
                queue.push(event);
                this.wake(sessionId);
            };

            live.unsub();
            let stepToolCalls = new Map<
                string,
                { name: string; startedAt: number; ok: boolean; callId: string; args: string }
            >();
            /** Y3：本回合是否发生过工具执行（总结轮仅在真实工作发生后追加） */
            let sawToolExecution = false;
            /**
             * 从 assistantMessageEvent 中提取工具调用信息。
             * 运行时实测形态（0.82–0.84）：{ type, contentIndex, partial: { content: [
             *   ... { type: "toolCall", id, name, arguments, partialArgs } ] } }；
             * 兼容声明形态 { id, toolName } / { toolCall: { id, name, arguments } }。
             */
            const extractToolCallInfo = (
                ame: Record<string, any>,
            ): { id?: string; name?: string; args?: unknown } => {
                const content = ame?.partial?.content;
                if (Array.isArray(content)) {
                    for (let i = content.length - 1; i >= 0; i -= 1) {
                        const item = content[i] as Record<string, any> | undefined;
                        if (item && item.type === "toolCall")
                            return { id: item.id, name: item.name, args: item.arguments };
                    }
                }
                if (typeof ame?.toolName === "string") return { id: ame?.id, name: ame.toolName };
                const tc = ame?.toolCall as Record<string, any> | undefined;
                if (tc && typeof tc === "object") return { id: tc.id, name: tc.name, args: tc.arguments };
                return {};
            };
            const unsub = live.session.subscribe((event: Record<string, any>) => {
                switch (event.type) {
                    case "message_update": {
                        const ame = event.assistantMessageEvent as Record<string, any> | undefined;
                        if (!ame) break;
                        if (ame.type === "text_delta" && typeof ame.delta === "string")
                            push({ type: "text_delta", delta: ame.delta });
                        else if (ame.type === "thinking_delta" && typeof ame.delta === "string")
                            push({ type: "thinking_delta", delta: ame.delta });
                        else if (ame.type === "toolcall_start") {
                            const idx = String(ame.contentIndex ?? "0");
                            const info = extractToolCallInfo(ame);
                            // 真实 callId（模型 toolCall.id）：与 tool_execution_* 事件对齐。
                            // 此处仅登记（模型仍在流式产出参数），tool_call_start 由
                            // tool_execution_start 推送——彼时参数已完整，卡片/面板可取全文。
                            stepToolCalls.set(idx, {
                                name: info.name ?? "tool",
                                startedAt: Date.now(),
                                ok: false,
                                callId: String(info.id ?? `tc-${idx}-${Date.now()}`),
                                args:
                                    info.args !== undefined && info.args !== null
                                        ? JSON.stringify(info.args).slice(0, 4096)
                                        : "",
                            });
                        } else if (ame.type === "toolcall_delta") {
                            // 参数以 JSON 流式下发：累积兜底（toolcall_end 时通常已完整）
                            const idx = String(ame.contentIndex ?? "0");
                            const call = stepToolCalls.get(idx);
                            if (call && typeof ame.delta === "string" && call.args.length < 8192)
                                call.args += ame.delta;
                        } else if (ame.type === "toolcall_end") {
                            const idx = String(ame.contentIndex ?? "0");
                            const prev = stepToolCalls.get(idx);
                            const info = extractToolCallInfo(ame);
                            stepToolCalls.set(idx, {
                                name: info.name ?? prev?.name ?? "tool",
                                startedAt: prev?.startedAt ?? Date.now(),
                                ok: true,
                                callId: prev?.callId ?? String(info.id ?? `tc-${idx}-${Date.now()}`),
                                args:
                                    info.args !== undefined
                                        ? JSON.stringify(info.args).slice(0, 4096)
                                        : (prev?.args ?? ""),
                            });
                        }
                        break;
                    }
                    case "message_end": {
                        const message = event.message as Record<string, any> | undefined;
                        if (message?.role !== "assistant") break;
                        // 注意：assistant 消息结束时工具尚未执行（stopReason=toolUse 后才执行），
                        // tool_call_end 由 tool_execution_end 事件推送（携带真实结果）。
                        const usage = message.usage as Record<string, number> | undefined;
                        if (usage) {
                            const inputTokens = usage.input ?? usage.promptTokens ?? 0;
                            const outputTokens = usage.output ?? usage.completionTokens ?? 0;
                            // T1.2 缓存可观测：透出 cacheRead/cacheWrite（部分端点缺省为 0）
                            const cacheReadTokens =
                                usage.cacheRead ?? usage.cacheReadInputTokens ?? 0;
                            const cacheWriteTokens =
                                usage.cacheWrite ?? usage.cacheWriteInputTokens ?? 0;
                            const hitRatio =
                                inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 100) : 0;
                            logStderr(
                                `[cache] mode=${live.mode} in=${inputTokens} out=${outputTokens} ` +
                                    `cacheRead=${cacheReadTokens} cacheWrite=${cacheWriteTokens} hit≈${hitRatio}%`,
                            );
                            push({
                                type: "usage",
                                inputTokens,
                                outputTokens,
                                cacheReadTokens,
                                cacheWriteTokens,
                            });
                        }
                        break;
                    }
                    case "tool_execution_start": {
                        // 工具真实执行开始：此刻参数已完整，推送 tool_call_start
                        // （卡片/面板可取全文：子代理 prompt、计划内容、todo 参数等）
                        sawToolExecution = true;
                        const callId = String(event.toolCallId ?? "");
                        const entry = [...stepToolCalls.entries()].find(
                            ([, c]) => c.callId === callId,
                        );
                        let argsPreview: string | undefined;
                        try {
                            if (event.args !== undefined)
                                argsPreview = JSON.stringify(event.args).slice(0, 4096);
                        } catch {
                            /* 参数不可序列化时省略 */
                        }
                        if (entry) entry[1].args = argsPreview ?? entry[1].args;
                        push({
                            type: "tool_call_start",
                            callId,
                            name: entry?.[1].name ?? String(event.toolName ?? "tool"),
                            argsPreview: argsPreview ?? "",
                        });
                        break;
                    }
                    case "tool_execution_end": {
                        // 工具执行完成：立即推送携带真实结果的 tool_call_end（Todo/子代理卡片取数）
                        const callId = String(event.toolCallId ?? "");
                        const entry = [...stepToolCalls.entries()].find(
                            ([, c]) => c.callId === callId,
                        );
                        let resultPreview: string | undefined;
                        try {
                            if (event.result !== undefined)
                                resultPreview = JSON.stringify(event.result).slice(0, 16384);
                        } catch {
                            /* 结果不可序列化时省略 */
                        }
                        push({
                            type: "tool_call_end",
                            callId,
                            ok: !event.isError,
                            durationMs: entry ? Date.now() - entry[1].startedAt : 0,
                            name: entry?.[1].name ?? String(event.toolName ?? "tool"),
                            resultPreview,
                        });
                        if (entry) stepToolCalls.delete(entry[0]);
                        break;
                    }
                    case "turn_end": {
                        // 回合收尾：未执行完（中止等场景）的工具调用以失败收尾
                        for (const [, call] of stepToolCalls)
                            push({
                                type: "tool_call_end",
                                callId: call.callId,
                                ok: false,
                                durationMs: Date.now() - call.startedAt,
                                name: call.name,
                            });
                        stepToolCalls = new Map();
                        break;
                    }
                    default:
                        break;
                }
            });
            live.unsub = () => unsub();

            try {
                await live.session.prompt(input.text);
                // Y1：回合成功打断错误序列，重置熔断计数
                this.breaker.reset(sessionId);
                // Y3 最终总结独立阶段：工作阶段发生过工具执行时，追加一轮收尾总结——
                // 只依据已验证的工具结果与工作区事实生成交付文本，防"工作日志冒充答案"。
                // 总结轮失败不影响工作成果（best effort）；未识别 summary_* 的旧客户端降级为连续文本。
                if (sawToolExecution) {
                    push({ type: "summary_started" });
                    try {
                        await live.session.prompt(SUMMARY_INSTRUCTION);
                    } catch (summaryErr) {
                        const summaryMessage =
                            summaryErr instanceof Error ? summaryErr.message : String(summaryErr);
                        logStderr(
                            `PiEngine 会话 ${sessionId} 总结轮失败（不影响工作成果）: ${summaryMessage}`,
                        );
                    }
                    push({ type: "summary_done" });
                }
                push({ type: "done", stopReason: "end_turn" });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logStderr(`PiEngine 会话 ${sessionId} 推理失败: ${message}`);
                // Y1 重复错误熔断：同类错误连续达阈值 → 标记不可恢复（调用方停止自动重试，
                // 进入可见错误收尾，避免无限烧 token）
                const breakerState = this.breaker.record(sessionId, message);
                if (breakerState.tripped)
                    logStderr(
                        `PiEngine 会话 ${sessionId} 触发重复错误熔断（连续 ${breakerState.count} 次同类错误）`,
                    );
                push({ type: "error", message, recoverable: !breakerState.tripped });
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

    /**
     * 切换会话模型（桌面模型选择器 → session.setModel）：
     * 目标模型与当前不同时重建会话（换模型=开新上下文）；
     * 相同或尚无会话时仅记录覆盖，下次 ensureSession 生效。
     */
    setModel(sessionId: string, modelId?: string): void {
        if (!modelId) return;
        const current =
            this.modelOverrides.get(sessionId) ??
            this.startConfig?.defaultModel?.modelId ??
            process.env.DEV_MODEL_ID ??
            "gpt-5.6-sol";
        this.modelOverrides.set(sessionId, modelId);
        if (modelId === current) return;
        const existing = this.sessions.get(sessionId);
        if (!existing) return;
        try {
            existing.unsub();
            void existing.session.abort().catch(() => undefined);
        } catch {
            /* 忽略重开异常 */
        }
        this.sessions.delete(sessionId);
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

    private async ensureSession(sessionId: string, mode: AgentMode, agentRole?: string): Promise<LiveSession> {
        const existing = this.sessions.get(sessionId);
        if (existing) return existing;
        if (!this.runtime || !this.startConfig)
            throw new Error("engine.start() 尚未调用");

        const config = this.startConfig;
        const modelId =
            this.modelOverrides.get(sessionId) ??
            config.defaultModel?.modelId ??
            process.env.DEV_MODEL_ID ??
            "gpt-5.6-sol";
        // cwd 取会话主工作区：无白名单时退化为临时目录且工具仍然受策略管控
        const workspaceRoot = process.env.AGENT_CORE_WORKSPACE ?? mkdtempSync(join(tmpdir(), `session-${sessionId.slice(0, 8)}-`));
        const cwd = workspaceRoot!;
        const agentDir = mkdtempSync(join(tmpdir(), `agent-dir-${randomUUID().slice(0, 8)}-`));

        // T1.1 模式指令 + T4.4 管理员下发技能，均作为第二 system 消息注入（前缀之后、动态数据之前）
        const skillInstructions = (this.startConfig?.skills ?? []).map(
            (s) => `【技能：${s.name}】${s.description}\n${s.content}`,
        );
        // 智能体 persona（选中智能体 → 角色设定作为 system 注入，对齐 Kun composerAgent）
        const agentInstructions = agentRole?.trim()
            ? [`【智能体 persona】\n${agentRole.trim()}`]
            : [];
        const resourceLoader = new DefaultResourceLoader({
            cwd,
            agentDir,
            systemPrompt: PLATFORM_SYSTEM_PROMPT,
            // T1.1 双模式：模式指令作为第二 system 消息注入（Kun 式，位于稳定前缀之后）
            appendSystemPrompt: [MODE_INSTRUCTIONS[mode], ...skillInstructions, ...agentInstructions],
            // Pi 官方扩展（todo/计划/子代理/结构化提问等）：noExtensions 只关自动发现，
            // additionalExtensionPaths 显式加载（resource-loader L270：noExtensions 下仍生效）
            additionalExtensionPaths: this.startConfig?.extensionPaths ?? [],
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
        });
        await resourceLoader.reload();

        // T2.4 工具按模式隔离：仅注入该模式允许的工具（缺省 modes 视为全模式）
        // 会话上下文（sessionId）随工具绑定，供会话级能力（知识库挂载）取数
        const modeTools = this.tools.filter(
            (t) => !t.modes || t.modes.includes(mode),
        );
        const { session } = await createAgentSession({
            model: this.buildModelObject(modelId),
            modelRuntime: this.runtime,
            resourceLoader,
            customTools: toPiTools(modeTools, { sessionId }),
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
            mode,
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
