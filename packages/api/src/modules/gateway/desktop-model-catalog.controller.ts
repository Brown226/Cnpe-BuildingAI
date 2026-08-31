import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";

import { DesktopModelCatalogService } from "./desktop-model-catalog.service";
import { GatewayUsageService } from "./gateway-usage.service";

/**
 * 桌面模型目录控制台（网关治理 P0 · A4）
 *
 * 管理员维护网关模型清单与单价：/consoleapi/desktop-models
 * 认证：consoleapi 前缀走全局管理员守卫（对齐 desktop-audit 控制台）。
 */
@Controller("consoleapi/desktop-models")
export class DesktopModelCatalogConsoleController {
    constructor(
        private readonly catalogService: DesktopModelCatalogService,
        private readonly usageService: GatewayUsageService,
    ) {}

    @Get()
    async list(): Promise<unknown[]> {
        return this.catalogService.listAll();
    }

    @Post()
    async create(@Body() dto: Record<string, unknown>): Promise<unknown> {
        return this.catalogService.create(dto as never);
    }

    @Put(":id")
    async update(@Param("id") id: string, @Body() dto: Record<string, unknown>): Promise<unknown> {
        return this.catalogService.update(id, dto as never);
    }

    @Delete(":id")
    async remove(@Param("id") id: string): Promise<{ ok: boolean }> {
        await this.catalogService.remove(id);
        return { ok: true };
    }

    /**
     * B3 用量报表（账本口径）：/consoleapi/desktop-models/usage
     * 按 部门 × 模式 × 模型 聚合 tokens 与成本（微元），供管理端用量报表页消费。
     */
    @Get("usage")
    async usage(
        @Query("from") from?: string,
        @Query("to") to?: string,
        @Query("departmentId") departmentId?: string,
        @Query("userId") userId?: string,
    ): Promise<Awaited<ReturnType<GatewayUsageService["summary"]>>> {
        return this.usageService.summary({
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            departmentId: departmentId || undefined,
            userId: userId || undefined,
        });
    }
}
