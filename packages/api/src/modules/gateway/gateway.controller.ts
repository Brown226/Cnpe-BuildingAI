import { WebController } from "@common/decorators";
import { HttpErrorFactory } from "@buildingai/errors";
import { Playground } from "@buildingai/decorators/playground.decorator";
import {
    Body,
    Controller,
    Get,
    HttpCode,
    Logger,
    Post,
    Req,
    Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable, Transform } from "node:stream";

import { GatewayService } from "./gateway.service";
import { GatewayUsageService } from "./gateway-usage.service";
import { DesktopModelCatalogService } from "./desktop-model-catalog.service";

/**
 * 桌面模型网关控制器（ADR-05）
 *
 * 客户端 Pi 引擎经本控制器访问内网模型：
 * - 真实上游 API Key 只存在于服务器（env / dict），永不下发客户端
 * - 客户端携带登录 JWT 即可调用，天然支持按用户吊销与审计
 * - 路径映射：/gateway/models → 上游 /models；/gateway/chat/completions → 上游同名
 *
 * 协议为 OpenAI 兼容（chat completions 流式/非流式均可），Pi 的
 * openai-completions provider 直接指向 {origin}/gateway 即可接入。
 *
 * 网关治理 P0 计量：流式与非流式统一落 desktop_usage_event（请求级权威账本）。
 * 客户端可透传 X-BuildingAI-Mode（code|work）与 X-BuildingAI-Session 会话标识；
 * 计量失败只告警，不影响模型请求主链路。
 */
@WebController("gateway")
export class GatewayWebController {
    private readonly logger = new Logger(GatewayWebController.name);

    constructor(
        private readonly gatewayService: GatewayService,
        private readonly usageService: GatewayUsageService,
        private readonly catalogService: DesktopModelCatalogService,
    ) {}

    /**
     * 模型清单下发（A4）：返回服务端目录（含单价/contextWindow/maxTokens/reasoning）。
     * 目录为空时回退上游透传（开发/灰度期兼容）。
     */
    @Get("models")
    async models(@Res() res: Response): Promise<void> {
        try {
            const entries = await this.catalogService.listActive();
            if (entries.length === 0) {
                // 兜底：目录未配置时保持旧行为（上游透传），不影响已有客户端
                const upstream = await this.gatewayService.forward("GET", "/models", undefined, undefined);
                res.status(upstream.status);
                this.copyHeaders(upstream, res);
                if (upstream.body) Readable.fromWeb(upstream.body as never).pipe(res);
                else res.end();
                return;
            }
            const models = entries.map((row) => this.catalogService.toPiModelEntry(row));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ object: "list", data: models }));
        } catch (err) {
            this.writeGatewayError(res, err);
        }
    }

    /** Chat Completions 透传（流式/非流式通用） */
    @Post("chat/completions")
    @HttpCode(200)
    async chatCompletions(
        @Req() req: Request,
        @Res() res: Response,
        @Playground() playground: UserPlaygroundLike,
    ): Promise<void> {
        await this.passthrough(req, res, "/chat/completions", playground);
    }

    /** 补全类接口预留（兼容部分代理端点）  */
    @Post("completions")
    @HttpCode(200)
    async completions(
        @Req() req: Request,
        @Res() res: Response,
        @Playground() playground: UserPlaygroundLike,
    ): Promise<void> {
        await this.passthrough(req, res, "/completions", playground);
    }

    private async passthrough(
        req: Request,
        res: Response,
        suffix: string,
        playground: UserPlaygroundLike,
    ): Promise<void> {
        const userId = playground?.id ?? "anonymous";
        try {
            // body-parser 已解析为对象——重新序列化转发，保持上游协议兼容
            const bodyText =
                req.body !== undefined && req.body !== null ? JSON.stringify(req.body) : undefined;
            const contentType = req.headers["content-type"];
            const startedAt = Date.now();
            const meta = this.readUsageMeta(req);

            const upstream = await this.gatewayService.forward("POST", suffix, bodyText, contentType);

            res.status(upstream.status);
            this.copyHeaders(upstream, res);

            const isStream = bodyText !== undefined && /"stream"\s*:\s*true/.test(bodyText);
            if (!isStream && upstream.body) {
                // 非流式：聚合后计量落库
                const text = await upstream.text();
                const parsed = this.parseNonStreamUsage(text);
                this.usageService
                    .record({
                        userId,
                        mode: meta.mode,
                        sessionId: meta.sessionId,
                        modelId: parsed.model ?? this.requestModel(req),
                        inputTokens: parsed.usage?.inputTokens ?? 0,
                        outputTokens: parsed.usage?.outputTokens ?? 0,
                        cacheReadTokens: parsed.usage?.cacheReadTokens ?? 0,
                        cacheWriteTokens: parsed.usage?.cacheWriteTokens ?? 0,
                        source: "gateway",
                    })
                    .catch(() => undefined);
                if (parsed.usage) {
                    this.logger.log(
                        `[gateway-usage] user=${userId} model=${parsed.model ?? "?"} in=${parsed.usage.inputTokens} out=${parsed.usage.outputTokens} ms=${Date.now() - startedAt}`,
                    );
                }
                res.send(text);
                return;
            }
            if (upstream.body) {
                this.pipeStreamWithMetering(upstream, res, { userId, meta, req, startedAt });
            } else {
                res.end();
            }
        } catch (err) {
            this.logger.warn(`网关转发失败(${suffix}): ${String(err)}`);
            this.writeGatewayError(res, err);
        }
    }

    /**
     * 流式透传 + 计量：tee 一份响应体到内存（上限 4MB 防御），
     * 响应结束后解析末尾 chunk 的 usage（OpenAI 兼容流式协议）落库。
     * 中断（close）时用已捕获的部分兜底记录，宁少记不丢记。
     */
    private pipeStreamWithMetering(
        upstream: { body: ReadableStream | null },
        res: Response,
        ctx: {
            userId: string;
            meta: { mode?: string; sessionId?: string };
            req: Request;
            startedAt: number;
        },
    ): void {
        const chunks: Buffer[] = [];
        let captured = 0;
        const MAX_CAPTURE = 4 * 1024 * 1024;
        const tee = new Transform({
            transform(chunk: Buffer, _enc, cb) {
                if (captured < MAX_CAPTURE) {
                    chunks.push(chunk);
                    captured += chunk.length;
                }
                cb(null, chunk);
            },
        });

        let recorded = false;
        const record = () => {
            if (recorded) return;
            recorded = true;
            const text = Buffer.concat(chunks).toString("utf8");
            const parsed = this.parseSseUsage(text);
            this.usageService
                .record({
                    userId: ctx.userId,
                    mode: ctx.meta.mode,
                    sessionId: ctx.meta.sessionId,
                    modelId: parsed?.model ?? this.requestModel(ctx.req),
                    inputTokens: parsed?.usage?.inputTokens ?? 0,
                    outputTokens: parsed?.usage?.outputTokens ?? 0,
                    cacheReadTokens: parsed?.usage?.cacheReadTokens ?? 0,
                    cacheWriteTokens: parsed?.usage?.cacheWriteTokens ?? 0,
                    source: "gateway",
                })
                .catch(() => undefined);
        };

        Readable.fromWeb(upstream.body as never).pipe(tee).pipe(res, { end: true });
        res.on("close", record);
    }

    /** 请求头里的模式与会话标识（客户端透传，缺失为 undefined） */
    private readUsageMeta(req: Request): { mode?: string; sessionId?: string } {
        const rawMode = String(req.headers["x-buildingai-mode"] ?? "").trim().toLowerCase();
        const mode = rawMode === "code" || rawMode === "work" ? rawMode : undefined;
        const sessionId = String(req.headers["x-buildingai-session"] ?? "").trim().slice(0, 64) || undefined;
        return { mode, sessionId };
    }

    /** 请求体里的模型标识（响应缺 model 字段时的兜底） */
    private requestModel(req: Request): string | undefined {
        const model = (req.body as { model?: unknown } | undefined)?.model;
        return typeof model === "string" && model ? model.slice(0, 160) : undefined;
    }

    /** OpenAI 兼容 usage 结构（含缓存字段多命名兼容） */
    private extractUsage(usage: Record<string, unknown> | undefined):
        | { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
        | undefined {
        if (!usage || typeof usage !== "object") return undefined;
        const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
        const details = (usage.prompt_tokens_details ?? null) as Record<string, unknown> | null;
        const inputTokens = num(usage.prompt_tokens);
        const cached = num(
            usage.cache_read_tokens ?? usage.cache_read_input_tokens ?? details?.cached_tokens,
        );
        return {
            inputTokens,
            outputTokens: num(usage.completion_tokens),
            cacheReadTokens: cached,
            cacheWriteTokens: num(usage.cache_write_tokens ?? usage.cache_write_input_tokens),
        };
    }

    /** 非流式响应解析 */
    private parseNonStreamUsage(text: string): {
        model?: string;
        usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    } {
        try {
            const json = JSON.parse(text) as { model?: string; usage?: Record<string, unknown> };
            return { model: json.model, usage: this.extractUsage(json.usage) };
        } catch {
            return {};
        }
    }

    /**
     * 流式响应解析：从捕获文本中倒序找带 usage 的 data 行
     * （OpenAI 兼容协议最后一个 chunk 携带 usage；[DONE] 前的一个 data）
     */
    private parseSseUsage(text: string):
        | { model?: string; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }
        | null {
        for (const line of text.split("\n").reverse()) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
                const json = JSON.parse(payload) as { model?: string; usage?: Record<string, unknown> };
                const usage = this.extractUsage(json.usage);
                if (usage) return { model: json.model, usage };
            } catch {
                /* 非法 JSON 行跳过 */
            }
        }
        return null;
    }

    private copyHeaders(
        upstream: { headers: { get(name: string): string | null } },
        res: Response,
    ): void {
        const passthroughHeaders = ["content-type", "cache-control", "x-request-id"];
        for (const h of passthroughHeaders) {
            const value = upstream.headers.get(h);
            if (value) res.setHeader(h, value);
        }
    }

    private writeGatewayError(res: Response, err: unknown): void {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
            res.status(message.includes("未启用") || message.includes("未配置") ? 503 : 502);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message, type: "gateway_error" } }));
    }
}

/** 避免直接依赖 db 类型在此处循环引用，用结构化最小类型 */
interface UserPlaygroundLike {
    id?: string;
    username?: string;
}
