import { parseScopeGroup, scopeGroupName, sortScopedRows } from "./scope-group.util";

describe("scope-group.util（T4.3 三级组名语法）", () => {
    describe("parseScopeGroup", () => {
        it("无冒号组名解析为组织级", () => {
            expect(parseScopeGroup("desktop_policy")).toEqual({
                base: "desktop_policy",
                level: "org",
            });
        });

        it(":d: 前缀解析为部门级", () => {
            expect(parseScopeGroup("desktop_policy:d:9f3a")).toEqual({
                base: "desktop_policy",
                level: "department",
                id: "9f3a",
            });
        });

        it(":u: 前缀解析为个人级", () => {
            expect(parseScopeGroup("desktop_skills:u:7a1b")).toEqual({
                base: "desktop_skills",
                level: "personal",
                id: "7a1b",
            });
        });

        it("旧裸 uuid 后缀兼容为部门级", () => {
            const uuid = "9f3a2b1c-0000-1111-2222-333344445555";
            expect(parseScopeGroup(`desktop_policy:${uuid}`)).toEqual({
                base: "desktop_policy",
                level: "department",
                id: uuid,
            });
        });

        it("非体系组名返回 null", () => {
            expect(parseScopeGroup("desktop_policy:weird")).toBeNull();
            expect(parseScopeGroup("some:thing")).toBeNull();
        });

        it("base 取首个冒号前段（合法 scoped 组名）", () => {
            expect(parseScopeGroup("desktop_policy:d:D1")?.base).toBe("desktop_policy");
            expect(parseScopeGroup("desktop_policy:u:U1")?.base).toBe("desktop_policy");
        });

        it("多冒号非语法组名视为非体系（返回 null）", () => {
            expect(parseScopeGroup("a:b:c")).toBeNull();
        });
    });

    describe("scopeGroupName", () => {
        it("生成部门/个人级组名", () => {
            expect(scopeGroupName("desktop_policy", "department", "D1")).toBe("desktop_policy:d:D1");
            expect(scopeGroupName("desktop_policy", "personal", "U1")).toBe("desktop_policy:u:U1");
        });
    });

    describe("sortScopedRows", () => {
        it("按 org < department < personal 升序排列（覆盖型：后应用者生效）", () => {
            const rows = [
                { group: "desktop_policy:u:U1", v: "personal" },
                { group: "desktop_policy", v: "org" },
                { group: "desktop_policy:d:D1", v: "department" },
            ];
            const sorted = sortScopedRows(rows);
            expect(sorted.map((r) => r.v)).toEqual(["org", "department", "personal"]);
        });

        it("同级保持稳定顺序", () => {
            const rows = [
                { group: "desktop_policy:d:D1", v: 1 },
                { group: "desktop_policy:d:D2", v: 2 },
            ];
            expect(sortScopedRows(rows).map((r) => r.v)).toEqual([1, 2]);
        });
    });
});
