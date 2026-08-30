/**
 * Migration: user-memory-scope
 * Version: 26.2.0
 *
 * T4.3 数据面 B2：ai_user_memory 三级 scope 分区。
 * - 加列 scope_type（varchar16，默认 personal）/ scope_id（uuid 可空）
 * - 存量回填：现有行均为个人记忆 → scope_type='personal', scope_id=user_id（幂等）
 * - 索引 (scope_type, scope_id) 供可见集查询
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class UserMemoryScope1788000001000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "ai_user_memory"
                ADD COLUMN IF NOT EXISTS "scope_type" varchar(16) NOT NULL DEFAULT 'personal',
                ADD COLUMN IF NOT EXISTS "scope_id" uuid
        `);
        await queryRunner.query(`
            UPDATE "ai_user_memory"
            SET "scope_id" = "user_id"
            WHERE "scope_type" = 'personal' AND "scope_id" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_ai_user_memory_scope"
            ON "ai_user_memory" ("scope_type", "scope_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_user_memory_scope"`);
        await queryRunner.query(`
            ALTER TABLE "ai_user_memory"
                DROP COLUMN IF EXISTS "scope_id",
                DROP COLUMN IF EXISTS "scope_type"
        `);
    }
}
