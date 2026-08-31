/**
 * Migration: user-memory-structure
 * Version: 26.2.0
 *
 * #6 记忆结构化（Yan long-term-memory 移植，数据面）：
 * - memory_type（六类）/ evidence（证据摘录）/ keywords（检索关键词 jsonb）/ occurrences（强化次数）
 * - 存量回填：按旧 category 尽力映射六类（preference/habit/instruction→preference，
 *   personal_info→environment，其余→project）；keywords IS NULL 判别存量行
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class UserMemoryStructure1788000003000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "ai_user_memory"
                ADD COLUMN IF NOT EXISTS "memory_type" varchar(24) NOT NULL DEFAULT 'project',
                ADD COLUMN IF NOT EXISTS "evidence" text,
                ADD COLUMN IF NOT EXISTS "keywords" jsonb,
                ADD COLUMN IF NOT EXISTS "occurrences" int NOT NULL DEFAULT 1
        `);
        await queryRunner.query(`
            UPDATE "ai_user_memory"
            SET "memory_type" = CASE "category"
                WHEN 'preference' THEN 'preference'
                WHEN 'habit' THEN 'preference'
                WHEN 'instruction' THEN 'preference'
                WHEN 'personal_info' THEN 'environment'
                ELSE 'project'
            END
            WHERE "keywords" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "ai_user_memory"
                DROP COLUMN IF EXISTS "occurrences",
                DROP COLUMN IF EXISTS "keywords",
                DROP COLUMN IF EXISTS "evidence",
                DROP COLUMN IF EXISTS "memory_type"
        `);
    }
}
