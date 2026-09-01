/**
 * 策略引擎单元测试（网关治理 P0 · M7 护栏核心）
 * 直接 import dist 产物（ESM），node --test 运行，零测试框架依赖。
 * 前置：agent-core 已 build（dist/ 存在）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PolicyEngine } from "../dist/policy/engine.js";
import { WorkspaceStore } from "../dist/workspace/store.js";

function makeEngine(opts = {}) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-engine-test-"));
    const ws = path.join(workDir, "ws");
    fs.mkdirSync(ws, { recursive: true });
    const store = new WorkspaceStore();
    if (opts.noWorkspace !== true) store.add(ws);
    const engine = new PolicyEngine(store);
    if (opts.mode) engine.configure({ mode: opts.mode });
    return { engine, ws, workDir };
}

test("黑名单硬拦截：任何模式（含 trust）都 deny 不可绕过", () => {
    for (const mode of ["strict", "balanced", "trust"]) {
        const { engine, ws } = makeEngine({ mode });
        const d = engine.decideCommand("rm -rf /tmp/data", ws);
        assert.equal(d.action, "deny");
        assert.match(d.rule, /^blacklist:/);
    }
});

test("黑名单追加不覆盖：管理员配置与默认规则同时生效", () => {
    const { engine, ws } = makeEngine({ mode: "trust" });
    engine.configure({ mode: "trust", commandBlacklist: ["^terraform\\s+destroy"] });
    assert.match(engine.decideCommand("terraform destroy -auto-approve", ws).rule, /^blacklist:/);
    assert.match(engine.decideCommand("shutdown /s", ws).rule, /^blacklist:/);
});

test("workspace 外 cwd → deny（exec_cwd_workspace）", () => {
    const { engine } = makeEngine({ mode: "balanced" });
    const d = engine.decideCommand("ls", "C:\\Windows");
    assert.equal(d.action, "deny");
    assert.equal(d.rule, "exec_cwd_workspace");
});

test("balanced：白名单命令自动放行", () => {
    const { engine, ws } = makeEngine({ mode: "balanced" });
    assert.equal(engine.decideCommand("git status", ws).action, "allow");
    assert.equal(engine.decideCommand("ls -la", ws).action, "allow");
});

test("balanced：白名单外普通命令 → require_approval", () => {
    const { engine, ws } = makeEngine({ mode: "balanced" });
    const d = engine.decideCommand("curl https://example.com", ws);
    assert.equal(d.action, "require_approval");
    assert.equal(d.rule, "mode_balanced_default");
});

test("balanced：git reset --hard 属白名单 git 命令但语义高风险 → require_approval（Y2 防绕过）", () => {
    const { engine, ws } = makeEngine({ mode: "balanced" });
    const d = engine.decideCommand("git reset --hard HEAD~1", ws);
    assert.equal(d.action, "require_approval");
    assert.equal(d.rule, "risk:git_destructive");
});

test("strict：一切命令均 require_approval", () => {
    const { engine, ws } = makeEngine({ mode: "strict" });
    assert.equal(engine.decideCommand("ls", ws).action, "require_approval");
    assert.equal(engine.decideCommand("git status", ws).action, "require_approval");
});

test("trust：全自动放行（ADR-06 信任档语义），高风险命令规则带类别", () => {
    const { engine, ws } = makeEngine({ mode: "trust" });
    assert.equal(engine.decideCommand("ls", ws).rule, "mode_trust");
    const risky = engine.decideCommand("git reset --hard", ws);
    assert.equal(risky.action, "allow");
    assert.match(risky.rule, /^mode_trust_risk:/);
});

test("decideFileOp：工作区外读/写一律 deny；工作区内读任何模式放行", () => {
    const { engine, ws } = makeEngine({ mode: "strict" });
    const outside = path.join(makeEngine({ noWorkspace: true }).workDir, "outside.txt");
    for (const op of ["read", "write"]) {
        assert.equal(engine.decideFileOp(outside, op).action, "deny");
    }
    assert.equal(engine.decideFileOp(path.join(ws, "a.txt"), "read").action, "allow");
});

test("decideFileOp：strict 写 → require_approval；balanced 写 → allow", () => {
    const strict = makeEngine({ mode: "strict" });
    assert.equal(strict.engine.decideFileOp(path.join(strict.ws, "a.txt"), "write").action, "require_approval");
    const balanced = makeEngine({ mode: "balanced" });
    assert.equal(balanced.engine.decideFileOp(path.join(balanced.ws, "a.txt"), "write").action, "allow");
});

test("审批天花板：configure 下发即上限，setMode 升档抛 PolicyDenied，降档放行", () => {
    const { engine } = makeEngine({ mode: "balanced" });
    assert.equal(engine.modeCeiling, "balanced");
    assert.throws(() => engine.setMode("trust"), (e) => e.code === -32001);
    engine.setMode("strict");
    assert.equal(engine.currentMode, "strict");
    engine.setMode("balanced");
    assert.equal(engine.currentMode, "balanced");
});

test("出网白名单：未配置不限制；配置后通配命中放行、域外拒绝、非法 URL 拒绝", () => {
    const { engine } = makeEngine({ mode: "balanced" });
    assert.equal(engine.decideEgress("https://anything.example.com").rule, "egress_unrestricted");

    engine.setEgressAllowlist(["*.corp.com", "api.open.com"]);
    assert.equal(engine.decideEgress("https://a.b.corp.com/x").action, "allow");
    assert.equal(engine.decideEgress("https://corp.com").action, "allow");
    const denied = engine.decideEgress("https://evil.com");
    assert.equal(denied.action, "deny");
    assert.equal(denied.rule, "egress_whitelist");
    assert.equal(engine.decideEgress("not a url").action, "deny");
});
