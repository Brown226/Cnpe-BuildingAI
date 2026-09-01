// jest CJS 运行时无法加载 @buildingai/errors → callsites(ESM-only) 链；
// 被测服务只用到实体类与 Repository 类型，全部 mock 掉即可。
jest.mock("@buildingai/db/entities", () => ({
    DesktopAuditEvent: class {},
    DesktopQuota: class {},
    DesktopUsageEvent: class {},
}));
jest.mock("@buildingai/db/typeorm", () => ({
    Repository: class {},
}));
jest.mock("@buildingai/db/@nestjs/typeorm", () => ({
    InjectRepository: () => () => undefined,
}));

import { DesktopQuotaService } from "./desktop-quota.service";

/** usageOf 聚合结果（按部门×月份模拟） */
const usageRows = new Map<string, { usedTokens: number; usedCostMicroYuan: number }>();

const quotaRepoMock = {
    findOne: jest.fn(async ({ where }: { where: { departmentId: string; month: string } }) => {
        const row = quotaRows.get(`${where.departmentId}:${where.month}`);
        return row ? { ...row } : null;
    }),
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (row: any) => row),
    find: jest.fn(async () => [...quotaRows.values()]),
};

const usageRepoMock = {
    createQueryBuilder: jest.fn(() => ({
        select: function () { return this; },
        addSelect: function () { return this; },
        where: function () { return this; },
        andWhere: function () { return this; },
        getRawOne: async function (this: { __dept: string }) {
            const key = this.__dept;
            const row = usageRows.get(key) ?? { usedTokens: 0, usedCostMicroYuan: 0 };
            return { tokens: String(row.usedTokens), cost: String(row.usedCostMicroYuan) };
        },
        __dept: "" as string,
    })),
};

const auditRepoMock = {
    insert: jest.fn(async () => undefined),
    create: (data: any) => ({ ...data }),
};

/** 便捷：给 createQueryBuilder 注入当前部门参数 */
function bindQueryBuilderDept() {
    (usageRepoMock.createQueryBuilder as jest.Mock).mockImplementation(() => ({
        select: function () { return this; },
        addSelect: function () { return this; },
        where: function (_: string, p: { departmentId: string }) { this.__dept = p.departmentId; return this; },
        andWhere: function () { return this; },
        getRawOne: async function (this: { __dept: string }) {
            const row = usageRows.get(this.__dept) ?? { usedTokens: 0, usedCostMicroYuan: 0 };
            return { tokens: String(row.usedTokens), cost: String(row.usedCostMicroYuan) };
        },
        __dept: "",
    }));
}

const quotaRows = new Map<string, any>();

function seedQuota(departmentId: string, over: Partial<any> = {}) {
    quotaRows.set(`${departmentId}:2026-09`, {
        departmentId,
        month: "2026-09",
        budgetTokens: null,
        budgetCostMicroYuan: null,
        warnThresholdPercent: 80,
        blockEnabled: false,
        ...over,
    });
}

describe("DesktopQuotaService（网关治理 P0 · B2 部门额度）", () => {
    let service: DesktopQuotaService;

    beforeEach(() => {
        jest.clearAllMocks();
        usageRows.clear();
        quotaRows.clear();
        bindQueryBuilderDept();
        service = new DesktopQuotaService(quotaRepoMock as any, usageRepoMock as any, auditRepoMock as any);
    });

    describe("status（配额状态）", () => {
        it("未设限部门 → null（不做任何阻断/告警）", async () => {
            expect(await service.status("d-none", "2026-09")).toBeNull();
        });

        it("token 双轴百分比按预算换算", async () => {
            seedQuota("d1", { budgetTokens: 1000, budgetCostMicroYuan: 10000 });
            usageRows.set("d1", { usedTokens: 500, usedCostMicroYuan: 2500 });
            const st = await service.status("d1", "2026-09");
            expect(st?.tokenPercent).toBe(50);
            expect(st?.costPercent).toBe(25);
            expect(st?.blocked).toBe(false);
        });

        it("默认只告警不阻断：达 100% 但 blockEnabled=false → blocked=false", async () => {
            seedQuota("d1", { budgetTokens: 1000, blockEnabled: false });
            usageRows.set("d1", { usedTokens: 1200, usedCostMicroYuan: 0 });
            const st = await service.status("d1", "2026-09");
            expect(st?.tokenPercent).toBe(120);
            expect(st?.blocked).toBe(false);
        });

        it("opt-in 硬阻断：blockEnabled=true 且超 100% → blocked=true", async () => {
            seedQuota("d1", { budgetTokens: 1000, blockEnabled: true });
            usageRows.set("d1", { usedTokens: 1200, usedCostMicroYuan: 0 });
            const st = await service.status("d1", "2026-09");
            expect(st?.blocked).toBe(true);
        });

        it("百分比封顶 999 防爆表", async () => {
            seedQuota("d1", { budgetTokens: 10 });
            usageRows.set("d1", { usedTokens: 100000, usedCostMicroYuan: 0 });
            const st = await service.status("d1", "2026-09");
            expect(st?.tokenPercent).toBe(999);
        });
    });

    describe("evaluateAfterRecord（告警里程碑）", () => {
        it("达 warn 阈值（默认 80%）→ 记 quota.warn 审计", async () => {
            seedQuota("d1", { budgetTokens: 1000 });
            usageRows.set("d1", { usedTokens: 850, usedCostMicroYuan: 0 });
            await service.evaluateAfterRecord("d1");
            expect(auditRepoMock.insert).toHaveBeenCalledTimes(1);
            const evt = (auditRepoMock.insert as jest.Mock).mock.calls[0][0];
            expect(evt.type).toBe("quota.warn");
        });

        it("达 100% → 记 quota.exceeded", async () => {
            seedQuota("d1", { budgetTokens: 1000 });
            usageRows.set("d1", { usedTokens: 1500, usedCostMicroYuan: 0 });
            await service.evaluateAfterRecord("d1");
            const evt = (auditRepoMock.insert as jest.Mock).mock.calls[0][0];
            expect(evt.type).toBe("quota.exceeded");
        });

        it("同部门同月同级别去重：第二次评估不再记审计", async () => {
            seedQuota("d1", { budgetTokens: 1000 });
            usageRows.set("d1", { usedTokens: 850, usedCostMicroYuan: 0 });
            await service.evaluateAfterRecord("d1");
            await service.evaluateAfterRecord("d1");
            expect(auditRepoMock.insert).toHaveBeenCalledTimes(1);
        });

        it("未达阈值不记审计", async () => {
            seedQuota("d1", { budgetTokens: 1000 });
            usageRows.set("d1", { usedTokens: 500, usedCostMicroYuan: 0 });
            await service.evaluateAfterRecord("d1");
            expect(auditRepoMock.insert).not.toHaveBeenCalled();
        });

        it("双轴取 max：token 未超但成本超 → 仍触发", async () => {
            seedQuota("d1", { budgetTokens: 100000, budgetCostMicroYuan: 1000 });
            usageRows.set("d1", { usedTokens: 5000, usedCostMicroYuan: 2000 });
            await service.evaluateAfterRecord("d1");
            const evt = (auditRepoMock.insert as jest.Mock).mock.calls[0][0];
            expect(evt.type).toBe("quota.exceeded");
        });

        it("无 departmentId → 直接返回", async () => {
            await service.evaluateAfterRecord(undefined);
            await service.evaluateAfterRecord(null);
            expect(usageRepoMock.createQueryBuilder).not.toHaveBeenCalled();
        });
    });

    describe("isBlocked（网关阻断判定）", () => {
        it("默认关（blockEnabled=false）→ 永不阻断", async () => {
            seedQuota("d1", { budgetTokens: 1000, blockEnabled: false });
            usageRows.set("d1", { usedTokens: 5000, usedCostMicroYuan: 0 });
            expect(await service.isBlocked("d1")).toBe(false);
        });

        it("blockEnabled=true 超 100% → 阻断（429 场景）", async () => {
            seedQuota("d1", { budgetTokens: 1000, blockEnabled: true });
            usageRows.set("d1", { usedTokens: 5000, usedCostMicroYuan: 0 });
            expect(await service.isBlocked("d1")).toBe(true);
        });

        it("评估后清缓存：超额落库后 isBlocked 立即反映新状态", async () => {
            seedQuota("d1", { budgetTokens: 1000, blockEnabled: true });
            usageRows.set("d1", { usedTokens: 500, usedCostMicroYuan: 0 });
            expect(await service.isBlocked("d1")).toBe(false);
            usageRows.set("d1", { usedTokens: 5000, usedCostMicroYuan: 0 });
            await service.evaluateAfterRecord("d1");
            expect(await service.isBlocked("d1")).toBe(true);
        });
    });

    describe("upsert（管理端配置）", () => {
        it("非法月份格式抛错", async () => {
            await expect(
                service.upsert({ departmentId: "d1", month: "2026/09", budgetTokens: 100 }),
            ).rejects.toThrow("YYYY-MM");
        });

        it("warnThresholdPercent 钳位在 1..100", async () => {
            seedQuota("d1");
            const saved = await service.upsert({ departmentId: "d1", month: "2026-09", warnThresholdPercent: 150 });
            expect(saved.warnThresholdPercent).toBe(100);
        });
    });
});
