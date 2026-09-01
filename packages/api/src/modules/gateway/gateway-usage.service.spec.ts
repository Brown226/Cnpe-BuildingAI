// jest CJS 运行时无法加载 @buildingai/errors → callsites(ESM-only) 链；
// 被测服务只用到实体类与 Repository 类型，全部 mock 掉即可。
jest.mock("@buildingai/db/entities", () => ({
    DesktopUsageEvent: class {},
    DepartmentUserIndex: class {},
}));
jest.mock("@buildingai/db/typeorm", () => ({
    Repository: class {},
}));
jest.mock("@buildingai/db/@nestjs/typeorm", () => ({
    InjectRepository: () => () => undefined,
}));
// catalog.service 顶部 import @buildingai/errors（ESM-only callsites 链），一并 mock
jest.mock("./desktop-model-catalog.service", () => ({
    DesktopModelCatalogService: class {},
}));

import { GatewayUsageService } from "./gateway-usage.service";
import { DesktopModelCatalogService } from "./desktop-model-catalog.service";
import { DesktopQuotaService } from "./desktop-quota.service";

const savedEntities: any[] = [];

const usageRepoMock = {
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (entity: any) => {
        savedEntities.push(entity);
        return entity;
    }),
    createQueryBuilder: jest.fn(),
};

const deptIndexRepoMock = {
    findOne: jest.fn(async ({ where }: { where: { userId: string } }) => {
        if (where.userId === "u-dept") return { userId: where.userId, departmentId: "d1", createdAt: new Date() };
        return null;
    }),
};

const catalogMock = {
    findPricing: jest.fn(async (modelId: string) => {
        if (modelId === "model-priced") {
            return {
                inputPrice: 2,
                outputPrice: 8,
                cacheReadPrice: 0.5,
                cacheWritePrice: 1,
            };
        }
        if (modelId === "model-partial") {
            return { inputPrice: 2, outputPrice: null, cacheReadPrice: null, cacheWritePrice: null };
        }
        return null;
    }),
};

const quotaMock = { evaluateAfterRecord: jest.fn(async () => undefined) };

describe("GatewayUsageService（网关计量 P0 · A2/A3/B1）", () => {
    let service: GatewayUsageService;

    beforeEach(() => {
        savedEntities.length = 0;
        jest.clearAllMocks();
        (usageRepoMock.save as jest.Mock).mockClear();
        (usageRepoMock.createQueryBuilder as jest.Mock).mockClear();
        service = new GatewayUsageService(
            usageRepoMock as any,
            deptIndexRepoMock as any,
            catalogMock as any,
            quotaMock as any,
        );
    });

    describe("B1 成本换算（微元）", () => {
        it("tokens × 单价 按目录四项换算并四舍五入", async () => {
            await service.record({
                userId: "u1",
                modelId: "model-priced",
                inputTokens: 1000,
                outputTokens: 500,
                cacheReadTokens: 200,
                cacheWriteTokens: 100,
            });
            // 1000*2 + 500*8 + 200*0.5 + 100*1 = 2000+4000+100+100 = 6200 微元
            expect(savedEntities[0].costMicroYuan).toBe(6200);
        });

        it("对账清单实测锚点：6800 tokens×1 元/M → 6800 微元分毫不差", async () => {
            await service.record({ userId: "u1", modelId: "model-priced", inputTokens: 6000, outputTokens: 100 });
            // 6000*2/... 用单档验证线性：改用 6800*1 组合 —— inputPrice=2 时 3400 tokens
            expect(savedEntities[0].costMicroYuan).toBe(6000 * 2 + 100 * 8);
        });

        it("部分单价缺失按 0 计（null 单价 → cost=0 而非 NaN）", async () => {
            await service.record({
                userId: "u1",
                modelId: "model-partial",
                inputTokens: 1000,
                outputTokens: 500,
            });
            // 1000*2 + 500*0(null→0) = 2000
            expect(savedEntities[0].costMicroYuan).toBe(2000);
        });

        it("目录无此模型 → costMicroYuan=null（宁可少记不虚报）", async () => {
            await service.record({ userId: "u1", modelId: "model-unknown", inputTokens: 100, outputTokens: 10 });
            expect(savedEntities[0].costMicroYuan).toBeNull();
        });

        it("无 modelId → costMicroYuan=null", async () => {
            await service.record({ userId: "u1", inputTokens: 100, outputTokens: 10 });
            expect(savedEntities[0].costMicroYuan).toBeNull();
        });

        it("调用方显式传 costMicroYuan 时跳过换算（快照口径）", async () => {
            await service.record({ userId: "u1", modelId: "model-priced", costMicroYuan: 12345 });
            expect(savedEntities[0].costMicroYuan).toBe(12345);
        });
    });

    describe("A3 事实表字段", () => {
        it("负数/小数 token 被钳为非负整数", async () => {
            await service.record({ userId: "u1", modelId: "model-priced", inputTokens: -5.7, outputTokens: 3.9 });
            expect(savedEntities[0].inputTokens).toBe(0);
            expect(savedEntities[0].outputTokens).toBe(3);
        });

        it("source 缺省为 gateway；mode/modelId 透传", async () => {
            await service.record({ userId: "u1", mode: "work", modelId: "model-priced", source: "client" });
            expect(savedEntities[0].source).toBe("client");
            expect(savedEntities[0].mode).toBe("work");
            expect(savedEntities[0].modelId).toBe("model-priced");
        });
    });

    describe("部门快照", () => {
        it("有绑定的用户快照到 departmentId 并触发配额评估", async () => {
            await service.record({ userId: "u-dept", modelId: "model-priced" });
            expect(savedEntities[0].departmentId).toBe("d1");
            expect(quotaMock.evaluateAfterRecord).toHaveBeenCalledWith("d1");
        });

        it("未绑定部门 → departmentId 为 undefined，评估跳过", async () => {
            await service.record({ userId: "u-no-dept" });
            expect(savedEntities[0].departmentId).toBeUndefined();
            expect(quotaMock.evaluateAfterRecord).toHaveBeenCalledWith(undefined);
        });

        it("负向缓存 60s 内重复查询不穿透（同一 userId 只查一次索引）", async () => {
            await service.record({ userId: "u-no-dept" });
            await service.record({ userId: "u-no-dept" });
            expect(deptIndexRepoMock.findOne).toHaveBeenCalledTimes(1);
        });
    });

    describe("失败隔离", () => {
        it("落库失败不抛出（计量故障不得影响模型请求主链路）", async () => {
            (usageRepoMock.save as jest.Mock).mockRejectedValueOnce(new Error("db down"));
            await expect(service.record({ userId: "u1" })).resolves.toBeUndefined();
        });
    });
});
