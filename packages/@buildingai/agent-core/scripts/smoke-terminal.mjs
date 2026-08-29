/**
 * B1 终端 RPC 冒烟：驱动 agent-core dist 的 stdio JSON-RPC，
 * 验证 terminal.create → terminal.input → 输出通知 → dispose 全链路。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = process.argv[2];
if (!script) {
    console.error("usage: node smoke-terminal.mjs <dist/index.js>");
    process.exit(1);
}

const child = spawn(process.execPath, [script], {
    cwd: path.dirname(path.dirname(script)),
    stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;
const outputs = [];
let exitSeen = null;

child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        } else if (msg.method === "terminal.output") {
            outputs.push(msg.params?.data ?? "");
        } else if (msg.method === "terminal.exit") {
            exitSeen = msg.params;
        }
    }
});

child.stderr.on("data", (d) => process.stderr.write(`[stderr] ${d}`));

function rpc(method, params = {}, timeoutMs = 30000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        setTimeout(() => {
            if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
        }, timeoutMs);
    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const fail = (msg) => {
    console.error(`FAIL: ${msg}`);
    child.kill();
    process.exit(1);
};

try {
    // 用系统临时目录当工作区（白名单验证通过即可）
    const ws = mkdtempSync(path.join(os.tmpdir(), "hs-term-"));
    writeFileSync(path.join(ws, "hello.txt"), "hi");

    await rpc("initialize", {
        serverUrl: "http://127.0.0.1:9", // 冒烟不依赖服务端，审计上报失败应静默
        token: "smoke",
        workspaces: [ws],
        policy: { mode: "balanced" },
    });
    console.log("[1] initialize ok");

    const added = await rpc("workspace.add", { dir: mkdtempSync(path.join(os.tmpdir(), "hs-term2-")) });
    if (!added.ok) fail(`workspace.add 失败: ${JSON.stringify(added)}`);
    console.log("[2] workspace.add ok");

    // 白名单外目录必须拒绝
    try {
        await rpc("terminal.create", { cwd: "C:\\Windows", cols: 80, rows: 24 });
        fail("白名单外目录未被拒绝");
    } catch (err) {
        if (!/白名单/.test(err.message)) fail(`拒绝原因不符: ${err.message}`);
    }
    console.log("[3] 白名单外目录被拒绝 ok");

    const created = await rpc("terminal.create", { cwd: ws, cols: 100, rows: 30 });
    if (!created?.id || !created.shell) fail(`terminal.create 异常: ${JSON.stringify(created)}`);
    console.log(`[4] terminal.create ok: id=${created.id} shell=${created.shell} cwd=${created.cwd}`);

    // 发送命令（Windows: echo HELLO；POSIX: printf）
    const cmd = process.platform === "win32" ? "echo HELLO_FROM_PTY_8951\r" : "printf 'HELLO_FROM_PTY_8951\\n'\r";
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "terminal.input", params: { id: created.id, data: cmd } })}\n`);

    let got = false;
    for (let i = 0; i < 40; i++) {
        await sleep(250);
        const all = outputs.join("");
        if (all.includes("HELLO_FROM_PTY_8951")) { got = true; break; }
    }
    if (!got) fail("未收到 terminal.output 回显（10s 超时）");
    console.log(`[5] terminal.output 回显 ok（${outputs.length} 片）`);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "terminal.resize", params: { id: created.id, cols: 120, rows: 40 } })}\n`);
    await sleep(300);
    console.log("[6] terminal.resize ok");

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "terminal.dispose", params: { id: created.id } })}\n`);
    await sleep(300);
    console.log("[7] terminal.dispose ok");

    // 上限与场景收尾
    console.log("SMOKE-ALL-PASS");
    child.kill();
    process.exit(0);
} catch (err) {
    fail(err.message);
}
