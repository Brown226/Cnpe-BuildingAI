import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { DepartmentUserIndex, DesktopUsageEvent } from "@buildingai/db/entities";

import { GatewayService } from "./gateway.service";
import { GatewayUsageService } from "./gateway-usage.service";
import { GatewayWebController } from "./gateway.controller";

/**
 * 桌面模型网关模块（ADR-05）
 *
 * 提供经服务端鉴权与密钥注入的 OpenAI 兼容转发：
 * GET  /gateway/models
 * POST /gateway/chat/completions（流式/非流式）
 *
 * 网关治理 P0：请求级计量落 desktop_usage_event（含 mode/modelId 维度与部门快照）。
 */
@Module({
    imports: [TypeOrmModule.forFeature([DesktopUsageEvent, DepartmentUserIndex])],
    controllers: [GatewayWebController],
    providers: [GatewayService, GatewayUsageService],
    exports: [GatewayService, GatewayUsageService],
})
export class GatewayModule {}
