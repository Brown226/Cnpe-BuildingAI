/**
 * 办公文档工具（MVP §3.3 最小办公闭环）：
 * - parse_document：docx/xlsx/csv/txt/md → 纯文本
 * - export_docx：Markdown → Word（标题/加粗/列表/普通段落）
 * - export_xlsx：二维行集 → Excel 工作表
 *
 * 所有 IO 均受策略层管控：路径必须位于工作区白名单内，
 * 严格模式下写入走审批卡片，流水记入审计采集器。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import * as XLSXModule from "xlsx";
// Node ESM 互操作：xlsx(CJS) 的完整导出挂在 default 下
type XLSXApi = typeof XLSXModule;
const XLSX = ((XLSXModule as unknown as { default?: XLSXApi }).default ?? XLSXModule) as XLSXApi;

import type { ApprovalBroker } from "../approval/broker.js";
import type { AuditCollector } from "../audit/collector.js";
import { RpcError, RpcErrorCodes } from "../protocol/messages.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { WorkspaceStore } from "../workspace/store.js";

/** 模型可消费的解析文本上限（字符），超出截断并标记 */
const PARSE_CHAR_LIMIT = 60_000;

export interface OfficeDeps {
    workspaces: WorkspaceStore;
    policy: PolicyEngine;
    approvals: ApprovalBroker;
    audit: AuditCollector;
}

type MdBlock = { text: string; kind: "h1" | "h2" | "h3" | "h4" | "bullet" | "p" };

function markdownToBlocks(md: string): MdBlock[] {
    return md
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((raw) => raw.trim())
        .filter((line) => line.length > 0 && !line.startsWith("```"))
        .map<MdBlock>((line) => {
            const h = /^(#{1,4})\s+(.*)$/.exec(line);
            if (h) return { text: h[2]!, kind: (`h${h[1]!.length}` as MdBlock["kind"]) };
            const bullet = /^[-*]\s+(.*)$/.exec(line);
            if (bullet) return { text: bullet[1]!, kind: "bullet" };
            return { text: line, kind: "p" };
        });
}

/** 极简行内渲染：支持 **加粗** 与去反引号 */
function inlineRuns(text: string): TextRun[] {
    const cleaned = text.replace(/`/g, "");
    const parts = cleaned.split(/\*\*(.+?)\*\*/g);
    return parts
        .filter((seg) => seg !== undefined && seg !== "")
        .map<TextRun>((seg, i) => new TextRun({ text: seg, bold: i % 2 === 1 }));
}

export class OfficeTools {
    constructor(private readonly deps: OfficeDeps) {}

    /** docx/xlsx/csv/txt/md 解析为纯文本 */
    async parseDocument(fileAbs: string): Promise<{ text: string; truncated: boolean; kind: string }> {
        const abs = path.resolve(fileAbs);
        const decision = this.deps.policy.decideFileOp(abs, "read");
        if (decision.action === "deny") {
            throw new RpcError(
                RpcErrorCodes.PolicyDenied,
                decision.reason ?? "策略拒绝读取该路径",
                { rule: decision.rule },
            );
        }
        if (!existsSync(abs)) throw new RpcError(RpcErrorCodes.InvalidParams, `文件不存在：${abs}`);

        const ext = path.extname(abs).toLowerCase();
        let text = "";
        switch (ext) {
            case ".docx": {
                const r = await mammoth.extractRawText({ path: abs });
                text = r.value;
                break;
            }
            case ".xlsx":
            case ".xlsm":
            case ".csv": {
                const wb = XLSX.readFile(abs, { dense: false });
                text = wb.SheetNames.map((name) => {
                    const ws = wb.Sheets[name];
                    if (!ws) return "";
                    return `### 工作表 ${name}\n${XLSX.utils.sheet_to_csv(ws)}`;
                })
                    .filter(Boolean)
                    .join("\n\n");
                break;
            }
            default: {
                // 文本类直接读取（含 .txt/.md 等）
                text = readFileSync(abs, "utf8");
            }
        }

        this.deps.audit.record({
            type: "tool.call",
            action: "office.parse",
            detail: { target: abs, chars: text.length },
        });
        return {
            text: text.slice(0, PARSE_CHAR_LIMIT),
            truncated: text.length > PARSE_CHAR_LIMIT,
            kind: ext.replace(".", ""),
        };
    }

    /** Markdown → Word 报告；严格模式弹审批 */
    async exportDocx(fileAbs: string, markdown: string): Promise<{ summary: string; bytesWritten: number }> {
        const abs = await this.guardedBinaryWrite(fileAbs, "Word 文档");
        const blocks = markdownToBlocks(markdown);
        const headingMap = {
            h1: HeadingLevel.HEADING_1,
            h2: HeadingLevel.HEADING_2,
            h3: HeadingLevel.HEADING_3,
            h4: HeadingLevel.HEADING_4,
        } as const;
        const paragraphs = blocks.map<Paragraph>((b) =>
            b.kind === "p"
                ? new Paragraph({ children: inlineRuns(b.text) })
                : b.kind === "bullet"
                  ? new Paragraph({ children: inlineRuns(b.text), bullet: { level: 0 } })
                  : new Paragraph({ children: inlineRuns(b.text), heading: headingMap[b.kind] }),
        );
        const doc = new Document({ sections: [{ children: paragraphs }] });
        const buffer = await Packer.toBuffer(doc);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, buffer);
        this.recordWrite(abs, buffer.length, `docx(${blocks.length} 块)`);
        return { summary: `已生成 Word 文档：${abs}`, bytesWritten: buffer.length };
    }

    /** 二维行集 → xlsx；严格模式弹审批 */
    async exportXlsx(
        fileAbs: string,
        rows: unknown[][],
        sheetName?: string,
    ): Promise<{ summary: string; bytesWritten: number; rowCount: number }> {
        if (!Array.isArray(rows) || rows.length === 0)
            throw new RpcError(RpcErrorCodes.InvalidParams, "rows 必须为非空二维数组");
        const abs = await this.guardedBinaryWrite(fileAbs, "Excel 表格");
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
        XLSX.utils.book_append_sheet(wb, ws, sheetName?.slice(0, 31) || "Sheet1");
        const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, out);
        this.recordWrite(abs, out.length, `xlsx(${rows.length} 行)`);
        return { summary: `已生成 Excel 表格：${abs}（${rows.length} 行）`, bytesWritten: out.length, rowCount: rows.length };
    }

    /**
     * T2.3 工件表格：结构化读取 xlsx（首工作表 → 二维数组），
     * 供前端表格编辑器预览与回写（read → 编辑 → exportXlsx 同路径覆盖）。
     */
    async readXlsx(
        fileAbs: string,
    ): Promise<{ rows: unknown[][]; sheetName: string; rowCount: number; colCount: number }> {
        const abs = path.resolve(fileAbs);
        const decision = this.deps.policy.decideFileOp(abs, "read");
        if (decision.action === "deny") {
            throw new RpcError(
                RpcErrorCodes.PolicyDenied,
                decision.reason ?? "策略拒绝读取该路径",
                { rule: decision.rule },
            );
        }
        if (!existsSync(abs)) throw new RpcError(RpcErrorCodes.InvalidParams, `文件不存在：${abs}`);
        const wb = XLSX.readFile(abs, { cellDates: false });
        const first = wb.SheetNames[0];
        if (!first) return { rows: [], sheetName: "Sheet1", rowCount: 0, colCount: 0 };
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first]!, {
            header: 1,
            defval: "",
            raw: true,
        }) as unknown[][];
        // 防止超大表打爆内存：行/列上限后截断
        const capped = rows.slice(0, 2000).map((r) => r.slice(0, 200));
        return {
            rows: capped,
            sheetName: first,
            rowCount: capped.length,
            colCount: capped[0]?.length ?? 0,
        };
    }

    // ── 内部 ───────────────────────────────────────────────────────────

    /**
     * 写入前置守卫：与 FileTools.write 同语义——deny 硬拒、require_approval 走
     * 审批卡片（二进制无 diff 预览，以类型与规模说明代替）。
     */
    private async guardedBinaryWrite(fileAbs: string, label: string): Promise<string> {
        const abs = path.resolve(fileAbs);
        const decision = this.deps.policy.decideFileOp(abs, "write");
        if (decision.action === "deny") {
            throw new RpcError(RpcErrorCodes.PolicyDenied, decision.reason ?? "策略拒绝写入", {
                rule: decision.rule,
            });
        }
        if (decision.action === "require_approval") {
            this.deps.audit.record({ type: "approval.requested", action: `office.write ${abs}` });
            const verdict = await this.deps.approvals.request({
                kind: "file_write",
                target: abs,
                detail: {
                    rule: decision.rule,
                    isNewFile: !existsSync(abs),
                    beforePreview: existsSync(abs) ? "(覆盖已有文件)" : "(新建)",
                    afterPreview: `${label}（二进制内容，写入后可打开查看）`,
                },
            });
            this.deps.audit.record({
                type: verdict.approved ? "approval.granted" : "approval.denied",
                action: `office.write ${abs}`,
                reason: verdict.reason,
            });
            if (!verdict.approved)
                throw new RpcError(RpcErrorCodes.ApprovalDenied, verdict.reason ?? "用户拒绝该写入");
        }
        return abs;
    }

    private recordWrite(abs: string, bytes: number, detailLabel: string): void {
        this.deps.audit.record({
            type: "tool.call",
            action: "office.write",
            detail: { target: abs, bytes, detail: detailLabel },
        });
    }
}
