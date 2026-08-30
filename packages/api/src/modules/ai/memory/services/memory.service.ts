import { BaseService } from "@buildingai/base";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { AgentMemory, UserMemory } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { Injectable, Logger } from "@nestjs/common";

import { ScopeResolver } from "@common/modules/scope/scope-resolver.service";

@Injectable()
export class MemoryService extends BaseService<UserMemory> {
    protected readonly logger = new Logger(MemoryService.name);

    constructor(
        @InjectRepository(UserMemory)
        private readonly userMemoryRepository: Repository<UserMemory>,
        @InjectRepository(AgentMemory)
        private readonly agentMemoryRepository: Repository<AgentMemory>,
        private readonly scopeResolver: ScopeResolver,
    ) {
        super(userMemoryRepository);
    }

    /**
     * 用户可见记忆（T4.3 隔离型三级并集）：个人 ∪ 本部门 ∪ 组织。
     * 个人记忆 scope=(personal, userId)；部门/组织记忆仅管理端写入。
     */
    async getUserMemories(userId: string, limit = 20): Promise<UserMemory[]> {
        const scope = await this.scopeResolver.resolve(userId);
        const departmentFilter =
            scope.departmentIds.length > 0
                ? " OR (m.scopeType = 'department' AND m.scopeId IN (:...departmentIds))"
                : "";
        return this.userMemoryRepository
            .createQueryBuilder("m")
            .where("m.isActive = :active", { active: true })
            .andWhere(
                "(m.scopeType = 'personal' AND m.scopeId = :userId) OR m.scopeType = 'org'" +
                    departmentFilter,
            )
            .orderBy("m.createdAt", "DESC")
            .take(limit)
            .setParameters(
                scope.departmentIds.length > 0 ? { userId, departmentIds: scope.departmentIds } : { userId },
            )
            .getMany();
    }

    /** 创建个人记忆（写入面收口：对话抽取/用户自写只落 personal） */
    async createUserMemory(params: {
        userId: string;
        content: string;
        category: string;
        source?: string;
        sourceAgentId?: string;
    }): Promise<UserMemory> {
        const isDuplicate = await this.isDuplicateUserMemory(params.userId, params.content);
        if (isDuplicate) {
            this.logger.debug(
                `Skipping duplicate user memory: "${params.content.slice(0, 60)}..."`,
            );
            return isDuplicate;
        }

        const memory = this.userMemoryRepository.create({
            userId: params.userId,
            content: params.content,
            category: params.category,
            source: params.source,
            sourceAgentId: params.sourceAgentId,
            isActive: true,
            scopeType: "personal",
            scopeId: params.userId,
        });
        return this.userMemoryRepository.save(memory);
    }

    /**
     * 管理端创建部门/组织共享记忆（T4.3：共享记忆仅管理端可写，防个人对话污染）。
     * userId 列保留创建者语义，可见性由 scope 列决定。
     */
    async createScopedMemory(params: {
        scopeType: "department" | "org";
        departmentId?: string;
        creatorId: string;
        content: string;
        category: string;
        source?: string;
    }): Promise<UserMemory> {
        const normalized = params.content.trim().toLowerCase();
        const duplicate = await this.userMemoryRepository
            .createQueryBuilder("m")
            .where("m.isActive = true")
            .andWhere("m.scopeType = :scopeType", { scopeType: params.scopeType })
            .andWhere(
                params.scopeType === "department"
                    ? "m.scopeId = :scopeId"
                    : "m.scopeId IS NULL",
                { scopeId: params.departmentId ?? null },
            )
            .andWhere("LOWER(TRIM(m.content)) = :normalized", { normalized })
            .getOne();
        if (duplicate) {
            this.logger.debug(
                `Skipping duplicate scoped memory: "${params.content.slice(0, 60)}..."`,
            );
            return duplicate;
        }

        const memory = this.userMemoryRepository.create({
            userId: params.creatorId,
            content: params.content,
            category: params.category,
            source: params.source,
            isActive: true,
            scopeType: params.scopeType,
            scopeId: params.scopeType === "department" ? params.departmentId : null,
        });
        return this.userMemoryRepository.save(memory);
    }

    /** 管理端按 scope 列出共享记忆（department 必带 departmentId） */
    async listScopedMemories(
        scopeType: "department" | "org",
        departmentId?: string,
        limit = 100,
    ): Promise<UserMemory[]> {
        const qb = this.userMemoryRepository
            .createQueryBuilder("m")
            .where("m.isActive = :active", { active: true })
            .andWhere("m.scopeType = :scopeType", { scopeType })
            .orderBy("m.createdAt", "DESC")
            .take(limit);
        if (scopeType === "department") {
            qb.andWhere("m.scopeId = :departmentId", { departmentId });
        } else {
            qb.andWhere("m.scopeId IS NULL");
        }
        return qb.getMany();
    }

    async getAgentMemories(userId: string, agentId: string, limit = 20): Promise<AgentMemory[]> {
        return this.agentMemoryRepository.find({
            where: { userId, agentId, isActive: true },
            order: { createdAt: "DESC" },
            take: limit,
        });
    }

    async createAgentMemory(params: {
        userId: string;
        agentId: string;
        content: string;
        category: string;
        source?: string;
    }): Promise<AgentMemory> {
        const isDuplicate = await this.isDuplicateAgentMemory(
            params.userId,
            params.agentId,
            params.content,
        );
        if (isDuplicate) {
            this.logger.debug(
                `Skipping duplicate agent memory: "${params.content.slice(0, 60)}..."`,
            );
            return isDuplicate;
        }

        const memory = this.agentMemoryRepository.create({
            userId: params.userId,
            agentId: params.agentId,
            content: params.content,
            category: params.category,
            source: params.source,
            isActive: true,
        });
        return this.agentMemoryRepository.save(memory);
    }

    /** 按 id 查个人记忆（删除保护：userId=创建者，共享记忆不可经员工端删除） */
    async findUserMemoryById(id: string, userId: string): Promise<UserMemory | null> {
        return this.userMemoryRepository.findOne({
            where: { id, userId, isActive: true },
        });
    }

    async deactivateUserMemory(id: string): Promise<void> {
        await this.userMemoryRepository.update(id, { isActive: false });
    }

    async deactivateAgentMemory(id: string): Promise<void> {
        await this.agentMemoryRepository.update(id, { isActive: false });
    }

    /** 个人记忆上限修剪（scopeType 守卫：不触碰部门/组织共享行） */
    async trimUserMemoriesToLimit(userId: string, maxCount: number): Promise<void> {
        if (maxCount <= 0) return;
        const toKeep = await this.userMemoryRepository.find({
            where: { userId, isActive: true, scopeType: "personal" },
            order: { createdAt: "DESC" },
            take: maxCount,
            select: ["id"],
        });
        const keepIds = toKeep.map((m) => m.id);
        if (keepIds.length === 0) return;
        await this.userMemoryRepository
            .createQueryBuilder()
            .update()
            .set({ isActive: false })
            .where("userId = :userId", { userId })
            .andWhere("scopeType = 'personal'")
            .andWhere("isActive = true")
            .andWhere("id NOT IN (:...keepIds)", { keepIds })
            .execute();
    }

    async trimAgentMemoriesToLimit(
        userId: string,
        agentId: string,
        maxCount: number,
    ): Promise<void> {
        if (maxCount <= 0) return;
        const toKeep = await this.agentMemoryRepository.find({
            where: { userId, agentId, isActive: true },
            order: { createdAt: "DESC" },
            take: maxCount,
            select: ["id"],
        });
        const keepIds = toKeep.map((m) => m.id);
        if (keepIds.length === 0) return;
        await this.agentMemoryRepository
            .createQueryBuilder()
            .update()
            .set({ isActive: false })
            .where("userId = :userId", { userId })
            .andWhere("agentId = :agentId", { agentId })
            .andWhere("isActive = true")
            .andWhere("id NOT IN (:...keepIds)", { keepIds })
            .execute();
    }

    private async isDuplicateUserMemory(
        userId: string,
        content: string,
    ): Promise<UserMemory | null> {
        const normalized = content.trim().toLowerCase();
        const existing = await this.userMemoryRepository
            .createQueryBuilder("m")
            .where("m.userId = :userId", { userId })
            .andWhere("m.isActive = true")
            .andWhere("m.scopeType = 'personal'")
            .andWhere("LOWER(TRIM(m.content)) = :normalized", { normalized })
            .getOne();
        return existing;
    }

    private async isDuplicateAgentMemory(
        userId: string,
        agentId: string,
        content: string,
    ): Promise<AgentMemory | null> {
        const normalized = content.trim().toLowerCase();
        const existing = await this.agentMemoryRepository
            .createQueryBuilder("m")
            .where("m.userId = :userId", { userId })
            .andWhere("m.agentId = :agentId", { agentId })
            .andWhere("m.isActive = true")
            .andWhere("LOWER(TRIM(m.content)) = :normalized", { normalized })
            .getOne();
        return existing;
    }
}
