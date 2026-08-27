/**
 * Migration: desktop-audit-event
 * Version: 26.1.2
 *
 * - 创建桌面客户端审计事件表 `desktop_audit_event`（ADR-07 强制上报部分）。
 *   内容为操作流水/工具调用/策略拦截/审批结果；会话正文不上报。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DesktopAuditEvent1781010000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "desktop_audit_event" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                "user_id" varchar(64),
                "occurred_at" timestamptz NOT NULL,
                "type" varchar(32) NOT NULL,
                "action" text NOT NULL,
                "rule" varchar(160),
                "reason" varchar(255),
                "detail" jsonb,
                CONSTRAINT "pk_desktop_audit_event" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_audit_user" ON "desktop_audit_event" ("user_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_audit_occurred" ON "desktop_audit_event" ("occurred_at")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_desktop_audit_type" ON "desktop_audit_event" ("type")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "desktop_audit_event"`);
    }
}
