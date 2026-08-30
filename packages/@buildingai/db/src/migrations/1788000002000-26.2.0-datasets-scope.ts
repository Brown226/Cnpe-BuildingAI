/**
 * Migration: datasets-scope
 * Version: 26.2.0
 *
 * T4.3 数据面 B3：datasets 部门绑定。
 * - 加列 scope_type（varchar16 可空）/ scope_id（uuid 可空）
 * - NULL/NULL = 未绑定，C 端成员制语义不变（双轨并存）
 * - department + deptId = 部门知识库；org + NULL = 组织共享
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DatasetsScope1788000002000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "datasets"
                ADD COLUMN IF NOT EXISTS "scope_type" varchar(16),
                ADD COLUMN IF NOT EXISTS "scope_id" uuid
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_datasets_scope"
            ON "datasets" ("scope_type", "scope_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_datasets_scope"`);
        await queryRunner.query(`
            ALTER TABLE "datasets"
                DROP COLUMN IF EXISTS "scope_id",
                DROP COLUMN IF EXISTS "scope_type"
        `);
    }
}
