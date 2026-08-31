/**
 * #9 运行级审阅（借鉴 Yan-Agent run-change-summary.js 的"本次运行"边界语义，MIT）。
 *
 * 以一次回合（run）为单位追踪 agent 对工作区文件的改动：
 * - 捕获：写族工具（write_file / export_* 系列 / Pi 原生 edit 系）执行**前**读取目标文件
 *   作为基线（每 run 每路径仅捕获一次；新文件基线为 null）；
 * - 审阅：list() 输出本次运行触碰的文件清单（是否存在过/二进制/大小）；
 * - 回滚：restore 基线内容；基线为 null 的新文件直接删除；二进制与超限文件跳过并报告。
 *
 * 与 Yan 的差异：不做 reverse-patch 重建——我们在工具执行前直接快照原内容，
 * 语义更简单且不依赖 OpenCode 消息结构。`execute` 命令对文件的改动不可追踪
 * （与 Yan 同限），回滚仅覆盖受管写工具。
 *
 * 纯 Node fs，无网络/进程依赖。
 */

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 基线快照上限：超过此大小的文件不捕获（回滚时跳过） */
const MAX_BASELINE_BYTES = 4 * 1024 * 1024;

/** 写族工具名（平台受管工具 + Pi 原生编辑工具的常见命名） */
export const WRITE_TOOL_NAMES = new Set([
    "write_file",
    "export_docx",
    "export_xlsx",
    "write",
    "edit",
    "multiedit",
    "str_replace",
    "notebook_edit",
]);

export interface RunChangeEntry {
    /** 工作区内绝对路径 */
    path: string;
    /** 运行前文件是否存在（false = 本次运行新建，回滚即删除） */
    existed: boolean;
    /** 是否二进制/超限（无法快照，回滚跳过） */
    binary: boolean;
    /** 当前文件大小（字节；不存在为 null） */
    currentSize: number | null;
}

export interface RunRollbackResult {
    /** 恢复的既有文件数 */
    restored: number;
    /** 删除的本次新建文件数 */
    deleted: number;
    /** 跳过项（二进制/超限/读取失败） */
    skipped: Array<{ path: string; reason: string }>;
}

/** 二进制嗅探（Yan stringLooksBinary 简化版）：NUL 字节或控制字符占比 >1% */
function looksBinary(buffer: Buffer): boolean {
    if (buffer.length === 0) return false;
    let controls = 0;
    for (const byte of buffer) {
        if (byte === 0) return true;
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) controls++;
    }
    return controls > Math.max(2, Math.floor(buffer.length * 0.01));
}

/** 从工具参数中提取目标路径（覆盖常见参数命名） */
export function extractTargetPath(args: unknown): string | null {
    if (!args || typeof args !== "object") return null;
    const record = args as Record<string, unknown>;
    for (const key of ["path", "file_path", "filePath", "target", "abs"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value;
    }
    return null;
}

interface BaselineEntry {
    /** 运行前内容；null = 运行前不存在（新建文件） */
    content: Buffer | null;
    binary: boolean;
    /** 运行前大小；不存在为 null */
    existed: boolean;
}

export class RunChangeTracker {
    private readonly baselines = new Map<string, BaselineEntry>();

    constructor(
        /** 会话工作区根（路径越界守卫） */
        readonly workspaceRoot: string,
    ) {}

    /** 是否写族工具 */
    static isWriteTool(toolName: string): boolean {
        return WRITE_TOOL_NAMES.has(toolName);
    }

    /**
     * 写族工具执行前调用：未捕获过的路径读取基线。
     * 越出工作区的路径忽略（策略层另有管控，此处仅防御）。
     */
    capture(toolName: string, args: unknown): void {
        if (!RunChangeTracker.isWriteTool(toolName)) return;
        const raw = extractTargetPath(args);
        if (!raw) return;
        const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(this.workspaceRoot, raw);
        const root = path.resolve(this.workspaceRoot);
        if (abs !== root && !abs.startsWith(root + path.sep)) return;
        if (this.baselines.has(abs)) return;

        try {
            if (!existsSync(abs)) {
                this.baselines.set(abs, { content: null, binary: false, existed: false });
                return;
            }
            const stat = statSync(abs);
            if (!stat.isFile()) return;
            if (stat.size > MAX_BASELINE_BYTES) {
                this.baselines.set(abs, { content: null, binary: true, existed: true });
                return;
            }
            const content = readFileSync(abs);
            if (looksBinary(content)) {
                this.baselines.set(abs, { content: null, binary: true, existed: true });
                return;
            }
            this.baselines.set(abs, { content, binary: false, existed: true });
        } catch {
            /* 读取失败不阻断工具执行；该路径不参与回滚 */
        }
    }

    /** 本次运行触碰的文件清单（当前状态采样） */
    list(): RunChangeEntry[] {
        return [...this.baselines.entries()].map(([filePath, baseline]) => {
            let currentSize: number | null = null;
            try {
                if (existsSync(filePath)) currentSize = statSync(filePath).size;
            } catch {
                /* 采样失败保持 null */
            }
            return {
                path: filePath,
                existed: baseline.existed,
                binary: baseline.binary,
                currentSize,
            };
        });
    }

    get size(): number {
        return this.baselines.size;
    }

    /** 回滚本次运行：恢复基线/删除新建文件/跳过二进制与超限 */
    rollback(): RunRollbackResult {
        const result: RunRollbackResult = { restored: 0, deleted: 0, skipped: [] };
        for (const [filePath, baseline] of this.baselines.entries()) {
            if (baseline.binary) {
                result.skipped.push({ path: filePath, reason: "二进制或超限文件不可自动回滚" });
                continue;
            }
            try {
                if (baseline.content === null) {
                    if (existsSync(filePath)) rmSync(filePath);
                    result.deleted++;
                } else {
                    writeFileSync(filePath, baseline.content);
                    result.restored++;
                }
            } catch (error) {
                result.skipped.push({
                    path: filePath,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return result;
    }
}
