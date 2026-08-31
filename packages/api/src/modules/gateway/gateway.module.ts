import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import {
    DepartmentUserIndex,
    DesktopAuditEvent,
    DesktopModelCatalog,
    DesktopQuota,
    DesktopUsageEvent,
} from "@buildingai/db/entities";

import { GatewayService } from "./gateway.service";
import { GatewayUsageService } from "./gateway-usage.service";
import { DesktopModelCatalogService } from "./desktop-model-catalog.service";
import { DesktopQuotaService } from "./desktop-quota.service";
import { DesktopModelCatalogConsoleController } from "./desktop-model-catalog.controller";
import { DesktopQuotaConsoleController } from "./desktop-quota.controller";
import { GatewayWebController } from "./gateway.controller";

/**
 * 桌面模型网关模块（ADR-05）
 *
 * 提供经服务端鉴权与密钥注入的 OpenAI 兼容转发：
 * GET  /gateway/models（目录下发，空目录回退上游透传）
 * POST /gateway/chat/completions（流式/非流式）
 *
 * 网关治理 P0：请求级计量落 desktop_usage_event（含 mode/modelId/成本/部门快照）；
 * 模型目录 consoleapi/desktop-models 维护清单与单价；
 * 部门配额 consoleapi/desktop-quotas 维护月度预算（默认只告警，阻断为 opt-in）。
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            DesktopUsageEvent,
            DesktopModelCatalog,
            DepartmentUserIndex,
            DesktopQuota,
            DesktopAuditEvent,
        ]),
    ],
    controllers: [GatewayWebController, DesktopModelCatalogConsoleController, DesktopQuotaConsoleController],
    providers: [GatewayService, GatewayUsageService, DesktopModelCatalogService, DesktopQuotaService],
    exports: [GatewayService, GatewayUsageService, DesktopModelCatalogService, DesktopQuotaService],
})
export class GatewayModule {}
