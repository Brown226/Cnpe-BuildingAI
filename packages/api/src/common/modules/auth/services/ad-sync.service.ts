import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@buildingai/core/@nestjs/schedule";

import { AdAuthService } from "./ad-auth.service";
import { AuthService } from "./auth.service";

/**
 * AD 组织架构定时同步服务（ADR-08 缺口一/三）
 *
 * 需要在管理后台配置只读服务账号（serviceAccountDn/serviceAccountPassword）后生效：
 * - 定时枚举全量域用户 → 属性/部门建档同步 + 域禁用账号联动撤销会话
 * - 支持管理员手动触发
 */
@Injectable()
export class AdSyncService {
    private readonly logger = new Logger(AdSyncService.name);
    /** 防重入：手动触发与定时可能重叠 */
    private running = false;

    constructor(
        private readonly adAuthService: AdAuthService,
        private readonly authService: AuthService,
    ) {}

    /**
     * 每天凌晨 2:30 执行一次域同步
     */
    @Cron("0 30 2 * * *")
    async runDaily(): Promise<void> {
        await this.runOnce("cron");
    }

    /** 手动触发入口（控制台按钮） */
    async runNow(): Promise<{
        skipped?: string;
        provisioned: number;
        updated: number;
        disabled: number;
    }> {
        return this.runOnce("manual");
    }

    private async runOnce(origin: "cron" | "manual"): Promise<{
        skipped?: string;
        provisioned: number;
        updated: number;
        disabled: number;
    }> {
        if (this.running) {
            return { skipped: "上一次同步仍在执行", provisioned: 0, updated: 0, disabled: 0 };
        }
        this.running = true;
        const startedAt = Date.now();
        try {
            const users = await this.adAuthService.listDomainUsers();
            if (users === null) {
                // 未启用或未配置服务账号：静默跳过（cron 场景），手动场景由前端提示
                this.logger.debug("AD 同步跳过：未启用或未配置服务账号");
                return { skipped: "AD 未启用或未配置服务账号", provisioned: 0, updated: 0, disabled: 0 };
            }
            const result = await this.authService.applyAdUsers(users);
            this.logger.log(
                `AD 同步完成(${origin}): 共 ${users.length} 个域用户, 新建 ${result.provisioned}, 更新 ${result.updated}, 禁用联动 ${result.disabled}, 耗时 ${Date.now() - startedAt}ms`,
            );
            return result;
        } finally {
            this.running = false;
        }
    }
}
