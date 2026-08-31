/**
 * Migration: desktop-model-catalog
 * Version: 26.2.1
 *
 * - 创建桌面模型目录表 `desktop_model_catalog`（网关治理 P0 · A4）。
 *   服务端维护的模型清单 + 单价 + 能力元数据；下发引擎与成本换算的唯一来源。
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class DesktopModelCatalog1788000011000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "desktop_model_catalog" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                "model_id" varchar(160) NOT NULL,
                "name" varchar(200) NOT NULL,
                "provider" varchar(64),
                "input_price" double precision NOT NULL DEFAULT 0,
                "output_price" double precision NOT NULL DEFAULT 0,
                "cache_read_price" double precision NOT NULL DEFAULT 0,
                "cache_write_price" double precision NOT NULL DEFAULT 0,
                "context_window" integer,
                "max_tokens" integer,
                "reasoning" boolean NOT NULL DEFAULT false,
                "is_active" boolean NOT NULL DEFAULT true,
                "sort_order" integer NOT NULL DEFAULT 0,
                "description" varchar(500),
                CONSTRAINT "pk_desktop_model_catalog" PRIMARY KEY ("id"),
                CONSTRAINT "uq_desktop_model_catalog_model_id" UNIQUE ("model_id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "desktop_model_catalog"`);
    }
}
