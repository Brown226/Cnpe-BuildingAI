/**
 * Migration: desktop-usage-event
 * Version: 26.2.1
 *
 * - 创建桌面模型用量计量事实表 `desktop_usage_event`（网关治理 P0 计量收口）。
 *   网关请求级计量（权威账本）+ 客户端兜底上报（source=client）双通道写入；
 *   审计表 desktop_audit_event 保持只增不改语义，不迁移历史数据。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DesktopUsageEvent1788000010000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "desktop_usage_event" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                "user_id" varchar(64),
                "occurred_at" timestamptz NOT NULL,
                "mode" varchar(16),
                "model_id" varchar(160),
                "provider" varchar(64),
                "session_id" varchar(64),
                "input_tokens" integer NOT NULL DEFAULT 0,
                "output_tokens" integer NOT NULL DEFAULT 0,
                "cache_read_tokens" integer NOT NULL DEFAULT 0,
                "cache_write_tokens" integer NOT NULL DEFAULT 0,
                "cost_micro_yuan" bigint,
                "source" varchar(16) NOT NULL DEFAULT 'gateway',
                "department_id" varchar(64),
                CONSTRAINT "pk_desktop_usage_event" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_usage_user" ON "desktop_usage_event" ("user_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_usage_occurred" ON "desktop_usage_event" ("occurred_at")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_usage_mode" ON "desktop_usage_event" ("mode")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_usage_model" ON "desktop_usage_event" ("model_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_usage_dept" ON "desktop_usage_event" ("department_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "desktop_usage_event"`);
    }
}
