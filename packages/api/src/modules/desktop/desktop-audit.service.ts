import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DesktopAuditEvent } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";

/** 客户端上报的事件载荷（与 agent-core AuditEvent 结构对齐） */
export interface IncomingAuditEvent {
    at: string;
    userId?: string;
    type: string;
    action: string;
    rule?: string;
    reason?: string;
    detail?: Record<string, unknown>;
}

const ALLOWED_TYPES = new Set([
    "session.start",
    "session.end",
    "tool.call",
    "policy.blocked",
    "approval.requested",
    "approval.granted",
    "approval.denied",
]);

@Injectable()
export class DesktopAuditService {
    private readonly logger = new Logger(DesktopAuditService.name);

    constructor(
        @InjectRepository(DesktopAuditEvent)
        private readonly repository: Repository<DesktopAuditEvent>,
    ) {}

    /**
     * 批量落库；非法/超限条目静默丢弃（审计通道不因脏数据中断）
     */
    async saveBatch(events: IncomingAuditEvent[]): Promise<{ saved: number; dropped: number }> {
        let dropped = 0;
        const entities: DesktopAuditEvent[] = [];

        for (const e of events.slice(0, 5000)) {
            if (!e || typeof e.action !== "string" || !ALLOWED_TYPES.has(e.type)) {
                dropped += 1;
                continue;
            }
            const occurredAt = new Date(e.at);
            entities.push(
                this.repository.create({
                    userId: e.userId?.slice(0, 64),
                    occurredAt:
                        Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
                    type: e.type,
                    action: e.action.slice(0, 10_000),
                    rule: e.rule?.slice(0, 160),
                    reason: e.reason?.slice(0, 255),
                    detail: isPlainObject(e.detail) ? e.detail : undefined,
                }),
            );
        }

        // 分批插入，单批 500 条
        for (let i = 0; i < entities.length; i += 500) {
            await this.repository.save(entities.slice(i, i + 500));
        }
        return { saved: entities.length, dropped };
    }

    /** 控制台查询（时间倒序分页） */
    async list(params: {
        page?: number;
        pageSize?: number;
        userId?: string;
        type?: string;
        from?: Date;
        to?: Date;
    }): Promise<{ items: DesktopAuditEvent[]; total: number }> {
        const page = Math.max(1, params.page ?? 1);
        const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

        const qb = this.repository.createQueryBuilder("event");
        if (params.userId) qb.andWhere("event.userId = :userId", { userId: params.userId });
        if (params.type) qb.andWhere("event.type = :type", { type: params.type });
        if (params.from) qb.andWhere("event.occurredAt >= :from", { from: params.from });
        if (params.to) qb.andWhere("event.occurredAt <= :to", { to: params.to });

        const total = await qb.getCount();
        const items = await qb
            .orderBy("event.occurredAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize)
            .getMany();

        return { items, total };
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
