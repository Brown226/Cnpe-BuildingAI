import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { Department, DepartmentUserIndex } from "@buildingai/db/entities";
import { Module } from "@nestjs/common";

import { DepartmentController } from "./controllers/console/department.controller";
import { DepartmentService } from "./services/department.service";

/**
 * 部门管理模块
 */
@Module({
    imports: [TypeOrmModule.forFeature([Department, DepartmentUserIndex])],
    controllers: [DepartmentController],
    providers: [DepartmentService],
    exports: [DepartmentService],
})
export class DepartmentModule {}