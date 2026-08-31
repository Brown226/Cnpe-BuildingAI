/**
 * P1-4 办公解析收口冒烟：驱动 agent-core dist 的 stdio JSON-RPC，
 * 验证 parseDocument 对 LFP 分流格式（pdf/pptx/html/json/xml）与
 * builtin 直读格式（docx/xlsx）的解析、60k 截断标志全链路。
 *
 * 用法：node smoke-office-parse.mjs <dist/index.js>
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = process.argv[2];
if (!script) {
    console.error("usage: node smoke-office-parse.mjs <dist/index.js>");
    process.exit(1);
}

const child = spawn(process.execPath, [script], {
    cwd: path.dirname(path.dirname(script)),
    stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;

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

const fail = (msg) => {
    console.error(`FAIL: ${msg}`);
    child.kill();
    process.exit(1);
};

/** 解析并断言 kind / 内容 / 截断标志 */
async function expectParse(file, kind, mustContain, { truncated = false, textLength = null } = {}) {
    const r = await rpc("office.parse", { path: file });
    if (r.kind !== kind) fail(`${path.basename(file)} kind=${r.kind} 期望 ${kind}`);
    if (typeof r.text !== "string" || r.text.length === 0) fail(`${path.basename(file)} text 为空`);
    for (const marker of mustContain) {
        if (!r.text.includes(marker)) fail(`${path.basename(file)} text 未包含「${marker}」`);
    }
    if (r.truncated !== truncated) fail(`${path.basename(file)} truncated=${r.truncated} 期望 ${truncated}`);
    if (textLength !== null && r.text.length !== textLength) fail(`${path.basename(file)} text 长度 ${r.text.length} 期望 ${textLength}`);
    console.log(`  ✓ ${path.basename(file)} kind=${r.kind} chars=${r.text.length} truncated=${r.truncated}`);
}

try {
    // trust 模式：export_* 写入自动放行，冒烟无需处理审批卡片
    const ws = mkdtempSync(path.join(os.tmpdir(), "hs-office-"));

    await rpc("initialize", {
        serverUrl: "http://127.0.0.1:9", // 冒烟不依赖服务端，审计上报失败应静默
        token: "smoke",
        workspaces: [ws],
        policy: { mode: "trust" },
    });
    console.log("[1] initialize ok（trust 模式）");

    // ── LFP 分流格式：直接写字符串文件 ──
    writeFileSync(
        path.join(ws, "note.html"),
        "<html><head><title>t</title></head><body><h1>季度报告</h1><p>营收同比增长 12%。</p></body></html>",
    );
    writeFileSync(
        path.join(ws, "data.json"),
        JSON.stringify({ department: "研发部", budget: { year: 2026, amount: "预算 480 万" }, items: [1, 2, 3] }),
    );
    writeFileSync(
        path.join(ws, "org.xml"),
        '<?xml version="1.0"?><org><region name="华东">营收 1200 万</region><region name="华北">营收 900 万</region></org>',
    );
    // >60k 字符 JSON：验证 LFP 路径的截断标志
    const big = { padding: "占位".repeat(10), rows: [] };
    for (let i = 0; i < 2400; i++) big.rows.push({ id: i, note: `行${i}：` + "内容填充".repeat(8) });
    writeFileSync(path.join(ws, "big.json"), JSON.stringify(big));

// ── 真实 PDF 夹具（Edge headless 打印生成，scripts/fixtures/smoke-fixture.pdf）──
// 手拼/生成器夹具与 pdf-parse 内置老版 pdf.js 兼容性差（bad XRef entry / 不支持 1.5+ xref 流），
// 真实渲染器输出的 PDF 才能代表生产解析路径，故直接提交夹具文件。
const FIXTURE_PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "smoke-fixture.pdf");
writeFileSync(path.join(ws, "doc.pdf"), readFileSync(FIXTURE_PDF));

    // ── 经 export 工具生成二进制（同时回归 builtin 路径）──
    const pptx = await rpc("office.exportPptx", {
        path: path.join(ws, "deck.pptx"),
        outline: "# 二期进展\n- 网关治理已落地\n- 额度告警已接\n# 下一步\n- 模板中心",
    });
    if (!pptx?.bytesWritten) fail(`exportPptx 异常: ${JSON.stringify(pptx)}`);
    const xlsx = await rpc("office.exportXlsx", {
        path: path.join(ws, "table.xlsx"),
        rows: [["部门", "用量"], ["研发部", "480 万"], ["市场部", "210 万"]],
    });
    if (!xlsx?.bytesWritten) fail(`exportXlsx 异常: ${JSON.stringify(xlsx)}`);
    const docx = await rpc("office.exportDocx", {
        path: path.join(ws, "note.docx"),
        markdown: "# 冒烟标题\n这是正文段落。",
    });
    if (!docx?.bytesWritten) fail(`exportDocx 异常: ${JSON.stringify(docx)}`);
    console.log("[2] 测试文件就绪（html/json/xml/pdf 直写 + pptx/xlsx/docx 经 export 生成）");

    console.log("[3] LFP 分流格式解析：");
    await expectParse(path.join(ws, "note.html"), "html", ["季度报告", "12%"]);
    await expectParse(path.join(ws, "data.json"), "json", ["研发部", "预算 480 万"]);
    await expectParse(path.join(ws, "org.xml"), "xml", ["华东", "1200 万"]);
    await expectParse(path.join(ws, "doc.pdf"), "pdf", ["Hello PDF Smoke 8951"]);
    await expectParse(path.join(ws, "deck.pptx"), "pptx", ["二期进展", "模板中心"]);
    await expectParse(path.join(ws, "big.json"), "json", [], { truncated: true, textLength: 60000 });

    console.log("[4] builtin 直读格式回归：");
    await expectParse(path.join(ws, "table.xlsx"), "xlsx", ["工作表", "研发部"]);
    await expectParse(path.join(ws, "note.docx"), "docx", ["冒烟标题", "正文段落"]);

    console.log("SMOKE-OFFICE-PARSE-PASS");
    child.kill();
    process.exit(0);
} catch (err) {
    fail(err.message);
}
