import { Module } from "@nestjs/common";

import { GatewayService } from "./gateway.service";
import { GatewayWebController } from "./gateway.controller";

/**
 * 桌面模型网关模块（ADR-05）
 *
 * 提供经服务端鉴权与密钥注入的 OpenAI 兼容转发：
 * GET  /gateway/models
 * POST /gateway/chat/completions（流式/非流式）
 */
@Module({
    controllers: [GatewayWebController],
    providers: [GatewayService],
    exports: [GatewayService],
})
export class GatewayModule {}
