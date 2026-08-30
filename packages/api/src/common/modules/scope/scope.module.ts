import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { DepartmentUserIndex } from "@buildingai/db/entities";
import { Module } from "@nestjs/common";

import { ScopeResolver } from "./scope-resolver.service";

/**
 * T4.3 scope 公共模块：userId → scope 集合解析与三级组名语法。
 * 配置面（desktop-config）与后续数据面（memory/datasets 分区）共用。
 */
@Module({
    imports: [TypeOrmModule.forFeature([DepartmentUserIndex])],
    providers: [ScopeResolver],
    exports: [ScopeResolver],
})
export class ScopeModule {}
