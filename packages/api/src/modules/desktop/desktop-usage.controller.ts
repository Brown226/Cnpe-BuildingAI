import { HttpErrorFactory } from "@buildingai/errors";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";

import { GatewayUsageService } from "../gateway/gateway-usage.service";

/**
 * 桌面用量兜底上报接收端点（网关治理 P0 · A2 客户端侧）
 *
 * 固定路径前缀 api/v1/desktop —— 与客户端 agent-core UsageReporter 的
 * 上报地址 `${serverUrl}/api/v1/desktop/usage/batch` 严格对齐。
 * 认证：全局 JWT 守卫（客户端携带登录令牌），未公开。
 *
 * 落库语义：source="client"（兜底账本，仅网关未覆盖场景产生数据；
 * 生产网关模式下客户端不启用上报，与 source="gateway" 天然不双算）。
 */
@Controller("api/v1/desktop")
export class DesktopUsageIngestController {
    constructor(private readonly usageService: GatewayUsageService) {}

    /** 批量上报用量兜底记录 */
    @Post("usage/batch")
    @HttpCode(200)
    async batch(
        @Body()
        body: {
            events?: Array<{
                mode?: string;
                modelId?: string;
                sessionId?: string;
                inputTokens?: number;
                outputTokens?: number;
                cacheReadTokens?: number;
                cacheWriteTokens?: number;
            }>;
        },
    ): Promise<{ saved: number; dropped: number }> {
        if (!body || !Array.isArray(body.events)) {
            throw HttpErrorFactory.badRequest("events 数组缺失");
        }
        let saved = 0;
        let dropped = 0;
        for (const e of body.events.slice(0, 5000)) {
            if (!e || typeof e !== "object") {
                dropped += 1;
                continue;
            }
            try {
                await this.usageService.record({
                    mode: typeof e.mode === "string" ? e.mode.slice(0, 16) : undefined,
                    modelId: typeof e.modelId === "string" ? e.modelId.slice(0, 160) : undefined,
                    sessionId: typeof e.sessionId === "string" ? e.sessionId.slice(0, 64) : undefined,
                    inputTokens: e.inputTokens,
                    outputTokens: e.outputTokens,
                    cacheReadTokens: e.cacheReadTokens,
                    cacheWriteTokens: e.cacheWriteTokens,
                    source: "client",
                });
                saved += 1;
            } catch {
                dropped += 1;
            }
        }
        return { saved, dropped };
    }
}
