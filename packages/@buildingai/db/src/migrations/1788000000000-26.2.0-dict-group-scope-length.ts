/**
 * Migration: dict-group-scope-length
 * Version: 26.2.0
 *
 * - 扩宽 dict 表 `group` 列 varchar(50) → varchar(100)。
 *   T4.3 scope 三级组名语法 `{group}:d:{deptId}` / `{group}:u:{userId}`
 *   以 `desktop_policy` 为例全长 53 字符，超出旧列宽（旧裸 `desktop_policy:{uuid}`
 *   = 51 字符同样超限，部门覆盖组实际不可写入）。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DictGroupScopeLength1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'config' AND column_name = 'group'
                      AND character_maximum_length IS NOT NULL
                      AND character_maximum_length < 100
                ) THEN
                    ALTER TABLE "config" ALTER COLUMN "group" TYPE varchar(100);
                END IF;
            END
            $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 不回缩：已写入的长组名回缩会截断/报错，保留宽列无害
        void queryRunner;
    }
}
