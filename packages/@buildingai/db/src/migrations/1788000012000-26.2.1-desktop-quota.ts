/**
 * Migration: desktop-quota
 * Version: 26.2.1
 *
 * - 创建部门月度配额表 `desktop_quota`（网关治理 P0 · B2）。
 *   部门 × 月份唯一；token/成本双轴预算（均可空=不设限）+ 告警阈值 + 硬阻断开关。
 *   默认策略只告警不阻断（BRD 决策），阻断为部门级 opt-in 开关。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DesktopQuota1788000012000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "desktop_quota" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                "department_id" varchar(64) NOT NULL,
                "month" varchar(7) NOT NULL,
                "budget_tokens" bigint,
                "budget_cost_micro_yuan" bigint,
                "warn_threshold_percent" integer NOT NULL DEFAULT 80,
                "block_enabled" boolean NOT NULL DEFAULT false,
                CONSTRAINT "pk_desktop_quota" PRIMARY KEY ("id"),
                CONSTRAINT "uq_desktop_quota_dept_month" UNIQUE ("department_id", "month")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "desktop_quota"`);
    }
}
