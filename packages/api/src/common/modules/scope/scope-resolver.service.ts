import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DepartmentUserIndex } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { Injectable, Logger } from "@nestjs/common";

/** 解析结果：用户可见的 scope 集合（隔离型并集 / 覆盖型优先级的输入） */
export interface ResolvedScope {
    userId: string;
    /** 用户所属部门 id 列表（department_user_index 实查） */
    departmentIds: string[];
    /** 组织级 scope 恒可用 */
    org: true;
}

interface CacheEntry {
    expiresAt: number;
    departmentIds: string[];
}

/** 部门关系缓存 TTL：调岗生效延迟上限（验收口径 ≤60s） */
const CACHE_TTL_MS = 60_000;

/**
 * T4.3 ScopeResolver：userId → scope 集合的唯一解析入口。
 *
 * - 部门关系走 department_user_index 实查（DB 权威），不依赖 JWT claim
 *   （LoginUserPlayground 无部门字段，desktop-config 旧解析恒 undefined——T4.3 修复项）
 * - 进程内短 TTL 缓存，避免每请求查表
 */
@Injectable()
export class ScopeResolver {
    private readonly logger = new Logger(ScopeResolver.name);
    private readonly cache = new Map<string, CacheEntry>();

    constructor(
        @InjectRepository(DepartmentUserIndex)
        private readonly departmentUserIndexRepository: Repository<DepartmentUserIndex>,
    ) {}

    async resolve(userId: string): Promise<ResolvedScope> {
        const now = Date.now();
        const hit = this.cache.get(userId);
        if (hit && hit.expiresAt > now) {
            return { userId, departmentIds: hit.departmentIds, org: true };
        }
        let departmentIds: string[] = [];
        try {
            const rows = await this.departmentUserIndexRepository.find({
                where: { userId },
                select: { departmentId: true },
            });
            departmentIds = rows.map((row) => row.departmentId);
        } catch (error) {
            // 部门索引不可读时降级为"仅组织级"，保证配置下发不中断（fail-open 到最宽边界，
            // 数据隔离型查询由调用方按 departmentIds 为空自然收窄）
            this.logger.warn(
                `ScopeResolver 查询部门索引失败，降级为仅组织级: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        this.cache.set(userId, { expiresAt: now + CACHE_TTL_MS, departmentIds });
        return { userId, departmentIds, org: true };
    }
}
