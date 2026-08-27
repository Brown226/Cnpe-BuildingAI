import { HttpErrorFactory } from "@buildingai/errors";
import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";

import { DesktopAuditService, type IncomingAuditEvent } from "./desktop-audit.service";

/**
 * 桌面审计接收端点
 *
 * 固定路径前缀 api/v1/desktop —— 与客户端 agent-core 审计采集器的
 * 上报地址 `${serverUrl}/api/v1/desktop/audit/batch` 严格对齐。
 * 认证：全局 JWT 守卫（客户端携带登录令牌），未公开。
 */
@Controller("api/v1/desktop")
export class DesktopAuditIngestController {
    constructor(private readonly auditService: DesktopAuditService) {}

    /** 批量上报操作流水 */
    @Post("audit/batch")
    @HttpCode(200)
    async batch(@Body() body: { events?: IncomingAuditEvent[] }): Promise<{
        saved: number;
        dropped: number;
    }> {
        if (!body || !Array.isArray(body.events)) {
            throw HttpErrorFactory.badRequest("events 数组缺失");
        }
        return this.auditService.saveBatch(body.events);
    }
}

/**
 * 桌面审计查询控制器（控制台）
 */
@Controller("consoleapi/desktop-audit")
export class DesktopAuditConsoleController {
    constructor(private readonly auditService: DesktopAuditService) {}

    @Get()
    async list(
        @Query("page") page?: string,
        @Query("pageSize") pageSize?: string,
        @Query("userId") userId?: string,
        @Query("type") type?: string,
        @Query("from") from?: string,
        @Query("to") to?: string,
    ): Promise<{ items: unknown[]; total: number }> {
        return this.auditService.list({
            page: page ? Number(page) : undefined,
            pageSize: pageSize ? Number(pageSize) : undefined,
            userId: userId || undefined,
            type: type || undefined,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
        });
    }
}
