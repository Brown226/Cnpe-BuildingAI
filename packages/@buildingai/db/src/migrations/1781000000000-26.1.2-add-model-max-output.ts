/**
 * Migration: add-model-max-output
 * Version: 26.1.2
 *
 * - Adds `max_output` column to `ai_models`（模型最大输出 Token 数）。
 *   历史行由 DEFAULT 4096 回填；后续由表单自动识别/手动填写写入具体值。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddModelMaxOutput1781000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "max_output" integer DEFAULT 4096`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ai_models" DROP COLUMN IF EXISTS "max_output"`);
    }
}