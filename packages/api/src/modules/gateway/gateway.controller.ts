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
import { Readable } from "node:stream";

import { GatewayService } from "./gateway.service";

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
 */
@WebController("gateway")
export class GatewayWebController {
    private readonly logger = new Logger(GatewayWebController.name);

    constructor(private readonly gatewayService: GatewayService) {}

    /** 模型列表透传 */
    @Get("models")
    async models(@Res() res: Response): Promise<void> {
        try {
            const upstream = await this.gatewayService.forward("GET", "/models", undefined, undefined);
            res.status(upstream.status);
            this.copyHeaders(upstream, res);
            if (upstream.body) Readable.fromWeb(upstream.body as never).pipe(res);
            else res.end();
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

    /** 补全类接口预留（兼容部分代理端点） */
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

            const upstream = await this.gatewayService.forward("POST", suffix, bodyText, contentType);

            res.status(upstream.status);
            this.copyHeaders(upstream, res);

            const isStream = bodyText !== undefined && /"stream"\s*:\s*true/.test(bodyText);
            if (!isStream && upstream.body) {
                // 非流式：聚合后计量记录（todo-9 审计消费）
                const text = await upstream.text();
                try {
                    const json = JSON.parse(text) as {
                        usage?: { prompt_tokens?: number; completion_tokens?: number };
                        model?: string;
                    };
                    if (json.usage) {
                        this.logger.log(
                            `[gateway-usage] user=${userId} model=${json.model ?? "?"} in=${json.usage.prompt_tokens ?? 0} out=${json.usage.completion_tokens ?? 0} ms=${Date.now() - startedAt}`,
                        );
                    }
                } catch {
                    /* 非法 JSON 不阻断响应 */
                }
                res.send(text);
                return;
            }
            if (upstream.body) {
                Readable.fromWeb(upstream.body as never).pipe(res);
            } else {
                res.end();
            }
        } catch (err) {
            this.logger.warn(`网关转发失败(${suffix}): ${String(err)}`);
            this.writeGatewayError(res, err);
        }
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
