import { Get } from "@nestjs/common";

import { WebController } from "../../common/decorators/controller.decorator";

/**
 * 桌面配置下发端点（§4 服务端改造清单：配置下发接口）
 *
 * 客户端登录后拉取本用户的管控配置包；当前下发默认权限模式，
 * 后续扩展黑名单/工作区建议目录/内置智能体清单（按部门 dict 扩展）。
 * 认证：全局 JWT 守卫，员工令牌访问。
 */
@WebController("desktop")
export class DesktopConfigController {
    /** 登录后拉取配置包 */
    @Get("config")
    async config(): Promise<{
        defaultPolicyMode: string;
        /** 版本号：策略变更时递增，客户端可据此感知需要刷新 */
        revision: number;
    }> {
        // TODO(部门下发)：读取部门 → 策略映射 dict（desktop_policy_default.{deptId}），
        // 未命中回退全局键 desktop_policy_default，再回退 balanced
        const globalMode = process.env.DESKTOP_DEFAULT_POLICY_MODE ?? "balanced";
        return { defaultPolicyMode: globalMode, revision: 1 };
    }
}
