import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { DesktopAuditEvent, Dict } from "@buildingai/db/entities";
import { Module } from "@nestjs/common";

import { DesktopAuditConsoleController, DesktopAuditIngestController } from "./desktop-audit.controller";
import { DesktopConfigController } from "./desktop-config.controller";
import { DesktopAuditService } from "./desktop-audit.service";

/**
 * 桌面客户端支撑模块
 *
 * - 配置下发：GET /api/desktop/config（默认权限模式 + 策略键表 T4.5）
 * - 审计上报接收：POST /api/v1/desktop/audit/batch（ADR-07 强制上服部分）
 * - 控制台查询：/consoleapi/desktop-audit
 */
@Module({
    imports: [TypeOrmModule.forFeature([DesktopAuditEvent, Dict])],
    controllers: [DesktopConfigController, DesktopAuditIngestController, DesktopAuditConsoleController],
    providers: [DesktopAuditService],
    exports: [DesktopAuditService],
})
export class DesktopModule {}
