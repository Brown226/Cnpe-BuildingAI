import { BaseService } from "@buildingai/base";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Department, DepartmentUserIndex } from "@buildingai/db/entities";
import { In, Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable } from "@nestjs/common";

import { CreateDepartmentDto, UpdateDepartmentDto } from "../dto/department.dto";

/**
 * 部门服务
 *
 * 提供部门树的增删改查与用户归属统计
 */
@Injectable()
export class DepartmentService extends BaseService<Department> {
    constructor(
        @InjectRepository(Department)
        private readonly departmentRepository: Repository<Department>,
        @InjectRepository(DepartmentUserIndex)
        private readonly departmentUserIndexRepository: Repository<DepartmentUserIndex>,
    ) {
        super(departmentRepository);
    }

    /**
     * 创建部门
     *
     * @param createDepartmentDto 创建数据
     * @returns 创建的部门
     */
    async createDepartment(createDepartmentDto: CreateDepartmentDto): Promise<Department> {
        const { name, parentId } = createDepartmentDto;

        // 校验同名部门
        const existing = await this.departmentRepository.findOne({ where: { name } });
        if (existing) {
            throw HttpErrorFactory.badRequest(`部门「${name}」已存在`);
        }

        // 计算层级
        let level = 1;
        if (parentId) {
            const parent = await this.departmentRepository.findOne({ where: { id: parentId } });
            if (!parent) {
                throw HttpErrorFactory.notFound("父部门不存在");
            }
            level = parent.level + 1;
        }

        const department = this.departmentRepository.create({
            name,
            parentId: parentId ?? null,
            level,
            system: 0,
        });
        return this.departmentRepository.save(department);
    }

    /**
     * 更新部门（改名 / 调整父级）
     *
     * @param id 部门ID
     * @param updateDepartmentDto 更新数据
     * @returns 更新后的部门
     */
    async updateDepartment(
        id: string,
        updateDepartmentDto: UpdateDepartmentDto,
    ): Promise<Department> {
        const department = await this.departmentRepository.findOne({ where: { id } });
        if (!department) {
            throw HttpErrorFactory.notFound("部门不存在");
        }

        // 防止把部门挂到自己的子孙节点上（会造成环）
        if (
            updateDepartmentDto.parentId &&
            updateDepartmentDto.parentId !== department.parentId
        ) {
            const descendantIds = await this.collectDescendantIds(id);
            if (descendantIds.includes(updateDepartmentDto.parentId)) {
                throw HttpErrorFactory.badRequest("不能将部门挂到自己的子部门下");
            }

            if (updateDepartmentDto.parentId === id) {
                throw HttpErrorFactory.badRequest("不能将部门挂到自己下面");
            }

            const parent = await this.departmentRepository.findOne({
                where: { id: updateDepartmentDto.parentId },
            });
            if (!parent) {
                throw HttpErrorFactory.notFound("父部门不存在");
            }
            department.level = parent.level + 1;
        }

        if (updateDepartmentDto.name !== undefined) {
            const existing = await this.departmentRepository.findOne({
                where: { name: updateDepartmentDto.name },
            });
            if (existing && existing.id !== id) {
                throw HttpErrorFactory.badRequest(`部门「${updateDepartmentDto.name}」已存在`);
            }
            department.name = updateDepartmentDto.name;
        }

        if (updateDepartmentDto.parentId !== undefined) {
            department.parentId = updateDepartmentDto.parentId;
        }

        return this.departmentRepository.save(department);
    }

    /**
     * 删除部门
     *
     * 存在子部门或存在用户归属时禁止删除
     *
     * @param id 部门ID
     */
    async deleteDepartment(id: string): Promise<void> {
        const department = await this.departmentRepository.findOne({ where: { id } });
        if (!department) {
            throw HttpErrorFactory.notFound("部门不存在");
        }

        const childCount = await this.departmentRepository.count({ where: { parentId: id } });
        if (childCount > 0) {
            throw HttpErrorFactory.badRequest("该部门下存在子部门，无法删除");
        }

        const memberCount = await this.departmentUserIndexRepository.count({
            where: { departmentId: id },
        });
        if (memberCount > 0) {
            throw HttpErrorFactory.badRequest("该部门下存在用户，无法删除");
        }

        await this.departmentRepository.remove(department);
    }

    /**
     * 查询部门树（含每个部门的用户数）
     *
     * @returns 部门树
     */
    async getDepartmentTree(): Promise<Array<Record<string, any>>> {
        const departments = await this.departmentRepository.find({
            order: { level: "ASC", createdAt: "ASC" },
        });

        // 批量统计各部门人数
        const memberRows = await this.departmentUserIndexRepository.find({
            select: ["departmentId", "userId"],
        });
        const memberCountMap = new Map<string, number>();
        for (const row of memberRows) {
            if (!row.departmentId) continue;
            memberCountMap.set(row.departmentId, (memberCountMap.get(row.departmentId) ?? 0) + 1);
        }

        const nodeMap = new Map<string, any>();
        for (const dept of departments) {
            nodeMap.set(dept.id, {
                id: dept.id,
                name: dept.name,
                parentId: dept.parentId,
                level: dept.level,
                system: dept.system,
                userCount: memberCountMap.get(dept.id) ?? 0,
                children: [],
            });
        }

        const roots: Array<Record<string, any>> = [];
        for (const dept of departments) {
            const node = nodeMap.get(dept.id)!;
            if (dept.parentId && nodeMap.has(dept.parentId)) {
                nodeMap.get(dept.parentId)!.children.push(node);
            } else {
                roots.push(node);
            }
        }

        return roots;
    }

    /**
     * 查询全部部门（扁平列表，供下拉选择）
     */
    async getAllDepartments(): Promise<Department[]> {
        return this.departmentRepository.find({
            order: { level: "ASC", createdAt: "ASC" },
        });
    }

    /**
     * 收集某部门的全部后代部门ID（含自身）
     *
     * @param id 部门ID
     * @returns 后代部门ID数组
     */
    private async collectDescendantIds(id: string): Promise<string[]> {
        const all = await this.departmentRepository.find({ select: ["id", "parentId"] });
        const result: string[] = [id];
        const queue = [id];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const dept of all) {
                if (dept.parentId === current && !result.includes(dept.id)) {
                    result.push(dept.id);
                    queue.push(dept.id);
                }
            }
        }
        return result;
    }

    /**
     * 批量查询用户所属部门
     *
     * @param userIds 用户ID数组
     * @returns Map<userId, Department[]>
     */
    async getDepartmentsByUserIds(userIds: string[]): Promise<Map<string, Department[]>> {
        const resultMap = new Map<string, Department[]>();
        if (userIds.length === 0) return resultMap;

        const rows = await this.departmentUserIndexRepository.find({
            where: { userId: In(userIds) },
            select: ["departmentId", "userId"],
        });
        const departmentIds = Array.from(
            new Set(rows.map((r) => r.departmentId).filter(Boolean)),
        );
        if (departmentIds.length === 0) return resultMap;

        const departments = await this.departmentRepository.find({
            where: { id: In(departmentIds) },
        });
        const departmentById = new Map(departments.map((d) => [d.id, d]));

        for (const row of rows) {
            const dept = departmentById.get(row.departmentId);
            if (!dept) continue;
            const list = resultMap.get(row.userId) ?? [];
            list.push(dept);
            resultMap.set(row.userId, list);
        }
        return resultMap;
    }
}