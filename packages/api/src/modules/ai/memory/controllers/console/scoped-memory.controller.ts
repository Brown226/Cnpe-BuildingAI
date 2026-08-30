import { type UserPlayground } from "@buildingai/db";
import { HttpErrorFactory } from "@buildingai/errors";
import { ConsoleController } from "@common/decorators/controller.decorator";
import { Permissions } from "@common/decorators/permissions.decorator";
import { Playground } from "@buildingai/decorators/playground.decorator";
import { Body, Delete, Get, Param, Post, Query } from "@nestjs/common";

import { CreateScopedMemoryDto, ListScopedMemoriesDto } from "../../dto/scoped-memory.dto";
import { MemoryService } from "../../services/memory.service";

/**
 * 部门/组织共享记忆管理端（T4.3）。
 * 隔离型语义：员工可见集 = 个人 ∪ 本部门 ∪ 组织；共享记忆仅管理员经此维护。
 */
@ConsoleController("scoped-memories", "共享记忆")
export class ScopedMemoryConsoleController {
    constructor(private readonly memoryService: MemoryService) {}

    @Get()
    @Permissions({ code: "list", name: "共享记忆列表", description: "按 scope 分页查询部门/组织共享记忆" })
    async list(@Query() dto: ListScopedMemoriesDto) {
        if (dto.scopeType === "department" && !dto.departmentId) {
            throw HttpErrorFactory.badRequest("scopeType=department 时必须提供 departmentId");
        }
        return this.memoryService.listScopedMemories(
            dto.scopeType,
            dto.departmentId,
            Math.min(Math.max(1, dto.limit ?? 100), 200),
        );
    }

    @Post()
    @Permissions({ code: "create", name: "创建共享记忆", description: "写入部门/组织共享记忆" })
    async create(@Body() dto: CreateScopedMemoryDto, @Playground() user: UserPlayground) {
        if (!user?.id) throw HttpErrorFactory.unauthorized();
        if (dto.scopeType === "department" && !dto.departmentId) {
            throw HttpErrorFactory.badRequest("scopeType=department 时必须提供 departmentId");
        }
        return this.memoryService.createScopedMemory({
            scopeType: dto.scopeType,
            departmentId: dto.departmentId,
            creatorId: user.id,
            content: dto.content,
            category: dto.category,
            source: dto.source,
        });
    }

    @Delete(":id")
    @Permissions({ code: "delete", name: "删除共享记忆", description: "停用部门/组织共享记忆" })
    async remove(@Param("id") id: string) {
        await this.memoryService.deactivateUserMemory(id);
        return { success: true };
    }
}
