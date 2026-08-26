import { BaseController } from "@buildingai/base";
import { UUIDValidationPipe } from "@buildingai/pipe/param-validate.pipe";
import { ConsoleController } from "@common/decorators";
import { Permissions } from "@common/decorators/permissions.decorator";
import { Body, Delete, Get, Param, Patch, Post } from "@nestjs/common";

import { CreateDepartmentDto, DeleteDepartmentDto, UpdateDepartmentDto } from "../../dto/department.dto";
import { DepartmentService } from "../../services/department.service";

/**
 * 部门管理控制器
 *
 * 提供部门树、创建、更新、删除等管理接口
 */
@ConsoleController("department", "部门管理")
export class DepartmentController extends BaseController {
    constructor(private readonly departmentService: DepartmentService) {
        super();
    }

    /**
     * 查询部门树
     *
     * @returns 部门树（含每部门用户数）
     */
    @Get("tree")
    @Permissions({
        code: "tree",
        name: "查看部门树",
        description: "查询部门树",
    })
    async tree() {
        return this.departmentService.getDepartmentTree();
    }

    /**
     * 查询全部部门（扁平列表，供下拉选择）
     */
    @Get("all")
    @Permissions({
        code: "all",
        name: "全部部门",
        description: "查询全部部门列表",
    })
    async all() {
        return this.departmentService.getAllDepartments();
    }

    /**
     * 创建部门
     *
     * @param createDepartmentDto 创建数据
     * @returns 创建的部门
     */
    @Post()
    @Permissions({
        code: "create",
        name: "创建部门",
        description: "创建新部门",
    })
    async create(@Body() createDepartmentDto: CreateDepartmentDto) {
        return this.departmentService.createDepartment(createDepartmentDto);
    }

    /**
     * 更新部门
     *
     * @param id 部门ID
     * @param updateDepartmentDto 更新数据
     * @returns 更新后的部门
     */
    @Patch(":id")
    @Permissions({
        code: "update",
        name: "更新部门",
        description: "更新部门信息",
    })
    async update(
        @Param("id", UUIDValidationPipe) id: string,
        @Body() updateDepartmentDto: UpdateDepartmentDto,
    ) {
        return this.departmentService.updateDepartment(id, updateDepartmentDto);
    }

    /**
     * 删除部门
     *
     * @param dto 删除数据
     */
    @Delete(":id")
    @Permissions({
        code: "delete",
        name: "删除部门",
        description: "删除部门",
    })
    async remove(@Param() dto: DeleteDepartmentDto) {
        await this.departmentService.deleteDepartment(dto.id);
        return { success: true };
    }
}