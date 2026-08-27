/**
 * agent-core 冒烟测试：直接以子进程方式拉起 sidecar，
 * 走完 initialize → workspace → 黑名单硬拦 → 白名单放行 → 审批写入 全链路。
 * 用法：node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sidecarPath = path.join(__dirname, "..", "dist", "index.js");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-core-smoke-"));
fs.mkdirSync(path.join(workDir, "ws"), { recursive: true });
fs.writeFileSync(path.join(workDir, "ws", "hello.txt"), "旧内容\n");

const child = spawn(process.execPath, [sidecarPath], {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[sidecar-stderr] ${d}`));

let nextId = 1;
const pending = new Map();
let notificationBuffer = [];

function request(method, params) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
}

let buffer = "";
child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (!p) continue;
            msg.error ? p.reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : p.resolve(msg.result);
        } else {
            notificationBuffer.push(msg);
        }
    }
});

async function main() {
    console.log("== 1. initialize");
    console.dir(await request("initialize", {
        serverUrl: "http://127.0.0.1:3000",
        token: "dev-token",
        userId: "smoke-user",
        policy: { mode: "balanced" },
        workspaces: [path.join(workDir, "ws")],
    }), { depth: 3 });

    console.log("== 2. workspace.list");
    console.log(await request("workspace.list", {}));

    console.log("== 3. 黑名单命令（应被 PolicyDenied 硬拒）");
    try {
        await request("exec.run", { command: "rm -rf /", cwd: path.join(workDir, "ws") });
        console.log("!!! 未拦截，测试失败");
    } catch (e) {
        console.log("已拦截 ✓ ->", e.message);
    }

    console.log("== 4. Windows 黑名单（del /f /s /q）");
    try {
        await request("exec.run", { command: "del /f /s /q C:\\Windows", cwd: path.join(workDir, "ws") });
        console.log("!!! 未拦截，测试失败");
    } catch (e) {
        console.log("已拦截 ✓ ->", e.message);
    }

    console.log("== 5. 白名单命令（git status，应自动放行）");
    const gitResult = await request("exec.run", { command: "git status", cwd: path.join(workDir, "ws") });
    console.log({ exitCode: gitResult.exitCode, timedOut: gitResult.timedOut, rule: gitResult.decisionRule });

    console.log("== 6. 非白名单命令（node --version，应弹审批→我们通过通知批准）");
    const p6 = request("exec.run", { command: "node --version", cwd: path.join(workDir, "ws") });
    setTimeout(() => {
        const req = notificationBuffer.findLast((n) => n.method === "approval/request");
        if (!req) return console.log("!!! 未收到审批请求通知");
        notificationBuffer = [];
        console.log("审批卡片:", { kind: req.params.kind, target: req.params.target });
        child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "approval/respond",
            params: { requestId: req.params.requestId, approved: true },
        })}\n`);
    }, 150);
    console.log({ exitCode: (await p6).exitCode });

    console.log("== 7. 工作区外读取（应被拒绝）");
    try {
        await request("fs.read", { path: path.join(workDir, "outside-secret.txt") });
        console.log("!!! 越权成功，测试失败");
    } catch (e) {
        console.log("已拒绝 ✓ ->", e.message);
    }

    console.log("== 8. 升档限制（balanced→trust 属升档，应被天花板拦截）");
    try {
        await request("policy.setMode", { mode: "trust" });
        console.log("!!! 升档成功，策略漏洞");
    } catch (e) {
        console.log("升档已禁止 ✓ ->", e.message);
    }

    console.log("== 9. 切严格模式后写入弹审批 → 批准");
    await request("policy.setMode", { mode: "strict" });
    const p9 = request("fs.write", {
        path: path.join(workDir, "ws", "hello.txt"),
        content: "新内容\n由本地引擎写入\n",
    });
    setTimeout(() => {
        const req = notificationBuffer.findLast((n) => n.method === "approval/request");
        if (!req) return console.log("!!! 未收到文件写入审批通知");
        notificationBuffer = [];
        console.log("审批卡片含旧内容预览 ✓:", String(req.params.detail.beforePreview).includes("旧内容"));
        child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "approval/respond",
            params: { requestId: req.params.requestId, approved: true },
        })}\n`);
    }, 150);
    console.log(await p9);

    console.log("== 10. 严格模式下读取仍自动放行");
    console.dir(await request("fs.read", { path: path.join(workDir, "ws", "hello.txt") }), {
        showHidden: false,
    });

    console.log("\n全部冒烟用例执行完毕。工作目录:", workDir);
}

main()
    .catch((err) => {
        console.error("冒烟失败:", err);
        process.exitCode = 1;
    })
    .finally(() => child.kill());
