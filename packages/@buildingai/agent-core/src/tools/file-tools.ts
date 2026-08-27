import fs from "node:fs";
import path from "node:path";
import { RpcError, RpcErrorCodes } from "../protocol/messages.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ApprovalBroker } from "../approval/broker.js";
import type { AuditCollector } from "../audit/collector.js";
import type { WorkspaceStore } from "../workspace/store.js";

const MAX_READ_BYTES = 512 * 1024;
const PREVIEW_BYTES = 4 * 1024;

export interface DirEntry {
    name: string;
    type: "file" | "dir";
    size?: number;
    mtimeMs?: number;
}

/**
 * 工作区文件操作（ADR-06 硬规则实现）：
 * 读取在工作区内自动放行；写入按权限模式走审批；
 * 工作区外一律硬拒绝。
 */
export class FileTools {
    constructor(
        private readonly workspaces: WorkspaceStore,
        private readonly policy: PolicyEngine,
        private readonly approvals: ApprovalBroker,
        private readonly audit: AuditCollector,
    ) {}

    list(dirRel: string): DirEntry[] {
        const abs = path.resolve(dirRel);
        this.guardFile(abs, "read", false);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        return entries.slice(0, 500).map((e) => {
            const item: DirEntry = { name: e.name, type: e.isDirectory() ? "dir" : "file" };
            try {
                const st = fs.statSync(path.join(abs, e.name));
                if (item.type === "file") item.size = st.size;
                item.mtimeMs = st.mtimeMs;
            } catch {
                /* race，忽略 */
            }
            return item;
        });
    }

    read(fileAbs: string): { content: string; truncated: boolean } {
        const abs = path.resolve(fileAbs);
        this.guardFile(abs, "read", false);
        const stat = fs.statSync(abs);
        if (!stat.isFile()) throw new RpcError(RpcErrorCodes.InvalidParams, "目标不是常规文件");
        const fh = fs.openSync(abs, "r");
        try {
            const buf = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
            fs.readSync(fh, buf, 0, buf.length, 0);
            return {
                content: buf.toString("utf8"),
                truncated: stat.size > MAX_READ_BYTES,
            };
        } finally {
            fs.closeSync(fh);
        }
    }

    async write(fileAbs: string, content: string): Promise<{ bytesWritten: number }> {
        const abs = path.resolve(fileAbs);
        // 写入决策带审批预览（新旧内容片段），供前端审批卡片 diff 呈现
        const decision = this.policy.decideFileOp(abs, "write");
        if (decision.action === "deny")
            throw new RpcError(RpcErrorCodes.PolicyDenied, decision.reason ?? "策略拒绝写入", {
                rule: decision.rule,
            });

        let before: string | null = null;
        try {
            before = fs.readFileSync(abs, "utf8").slice(0, PREVIEW_BYTES);
        } catch {
            /* 新文件无旧内容 */
        }

        if (decision.action === "require_approval") {
            this.audit.record({ type: "approval.requested", action: `fs.write ${abs}` });
            const verdict = await this.approvals.request({
                kind: "file_write",
                target: abs,
                detail: {
                    rule: decision.rule,
                    isNewFile: before === null,
                    beforePreview: before ?? "(新建)",
                    afterPreview: content.slice(0, PREVIEW_BYTES),
                },
            });
            this.audit.record({
                type: verdict.approved ? "approval.granted" : "approval.denied",
                action: `fs.write ${abs}`,
                reason: verdict.reason,
            });
            if (!verdict.approved)
                throw new RpcError(
                    RpcErrorCodes.ApprovalDenied,
                    verdict.reason ?? "用户拒绝该写入",
                );
        }

        fs.mkdirSync(path.dirname(abs), { recursive: true });
        // 原子写：tmp + rename（Kun workspace-file-core 同款）
        const tmp = `${abs}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        fs.writeFileSync(tmp, content, "utf8");
        fs.renameSync(tmp, abs);
        this.audit.record({
            type: "tool.call",
            action: "fs.write",
            detail: { target: abs, bytesWritten: Buffer.byteLength(content) },
        });
        return { bytesWritten: Buffer.byteLength(content) };
    }

    // ── 目录条目管理（复刻 Kun workspace-file-entries：新建/重命名/删除） ──

    /** 新建文件或目录；父目录必须已在工作区内 */
    async createEntry(targetAbs: string, type: "file" | "directory"): Promise<{ path: string }> {
        const abs = path.resolve(targetAbs);
        this.assertInside(abs);
        if (fs.existsSync(abs))
            throw new RpcError(RpcErrorCodes.InvalidParams, `目标已存在：${abs}`);
        await this.guardWriteWithApproval(abs, "(新建)", type === "directory" ? "新目录" : "空文件");
        if (type === "directory") {
            fs.mkdirSync(abs, { recursive: true });
        } else {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, "", "utf8");
        }
        this.audit.record({ type: "tool.call", action: "fs.create", detail: { target: abs, entryType: type } });
        return { path: abs };
    }

    /** 重命名（仅条目名，不允许路径分隔符；工作区根本身不可重命名） */
    async renameEntry(targetAbs: string, newName: string): Promise<{ path: string }> {
        if (!newName || /[\\/]/.test(newName) || newName === "." || newName === "..")
            throw new RpcError(RpcErrorCodes.InvalidParams, `非法名称：${newName}`);
        const abs = path.resolve(targetAbs);
        this.assertInside(abs);
        if (this.isWorkspaceRoot(abs))
            throw new RpcError(RpcErrorCodes.PolicyDenied, "工作区根目录不可重命名", { rule: "workspace_root" });
        if (!fs.existsSync(abs))
            throw new RpcError(RpcErrorCodes.InvalidParams, `源不存在：${abs}`);
        const target = path.resolve(path.dirname(abs), newName);
        this.assertInside(target);
        if (fs.existsSync(target))
            throw new RpcError(RpcErrorCodes.InvalidParams, `目标已存在：${target}`);
        await this.guardWriteWithApproval(abs, `重命名前`, `重命名 → ${newName}`);
        fs.renameSync(abs, target);
        this.audit.record({
            type: "tool.call",
            action: "fs.rename",
            detail: { from: abs, to: target },
        });
        return { path: target };
    }

    /** 删除文件/目录（目录递归）；工作区根本身不可删除 */
    async deleteEntry(targetAbs: string): Promise<{ deleted: boolean }> {
        const abs = path.resolve(targetAbs);
        this.assertInside(abs);
        if (this.isWorkspaceRoot(abs))
            throw new RpcError(RpcErrorCodes.PolicyDenied, "不能删除工作区根目录", { rule: "workspace_root" });
        if (!fs.existsSync(abs)) return { deleted: false };
        const isDir = fs.statSync(abs).isDirectory();
        await this.guardWriteWithApproval(
            abs,
            `${isDir ? "目录（含全部内容）" : "文件"}将被删除`,
            `删除 ${isDir ? "目录" : "文件"}`,
        );
        fs.rmSync(abs, { recursive: true, force: false });
        this.audit.record({ type: "tool.call", action: "fs.delete", detail: { target: abs, entryType: isDir ? "dir" : "file" } });
        return { deleted: true };
    }

    /**
     * 最近修改文件（复刻 Kun Recent modified files）：
     * 有限深度的递归扫描，按 mtime 降序返回前 limit 条。
     */
    recentFiles(
        rootAbs: string,
        options?: { limit?: number; maxDepth?: number; maxEntries?: number },
    ): Array<{ path: string; name: string; mtimeMs: number; size?: number }> {
        const root = path.resolve(rootAbs);
        this.guardFile(root, "read", false);
        const limit = Math.min(options?.limit ?? 8, 50);
        const maxDepth = Math.min(options?.maxDepth ?? 3, 6);
        const maxEntries = options?.maxEntries ?? 800;
        const found: Array<{ path: string; name: string; mtimeMs: number; size?: number }> = [];
        const walk = (dir: string, depth: number): void => {
            if (depth > maxDepth || found.length >= maxEntries) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                if (found.length >= maxEntries) return;
                if (e.name.startsWith(".")) continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    walk(full, depth + 1);
                } else if (e.isFile()) {
                    try {
                        const st = fs.statSync(full);
                        found.push({
                            path: full,
                            name: e.name,
                            mtimeMs: st.mtimeMs,
                            size: st.size,
                        });
                    } catch {
                        /* race，忽略 */
                    }
                }
            }
        };
        walk(root, 1);
        return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
    }

    /** 策略判定 + 拒绝上抛；审批动作由调用方处理 */
    private guardFile(abs: string, op: "read" | "write", withApproval: boolean): void {
        const decision = this.policy.decideFileOp(abs, op);
        if (decision.action === "deny") {
            this.audit.record({ type: "policy.blocked", action: `fs.${op}`, rule: decision.rule });
            throw new RpcError(RpcErrorCodes.PolicyDenied, decision.reason ?? "策略拒绝", {
                rule: decision.rule,
            });
        }
        if (withApproval && decision.action === "require_approval")
            throw new Error("请在 write() 中使用 approval 流程");
    }

    // ── 内部 ───────────────────────────────────────────────────────────

    private assertInside(abs: string): void {
        if (!this.workspaces.isInsideWorkspace(abs))
            throw new RpcError(RpcErrorCodes.PolicyDenied, `路径不在工作区白名单内：${abs}`, {
                rule: "workspace_whitelist",
            });
    }

    private isWorkspaceRoot(abs: string): boolean {
        const lower = process.platform === "win32" ? abs.toLowerCase() : abs;
        return this.workspaces
            .list()
            .some((r) => (process.platform === "win32" ? r.toLowerCase() : r) === lower);
    }

    /** deny 硬拒；require_approval 走审批卡片（复用 file_write 通道，预览用说明文本代替 diff） */
    private async guardWriteWithApproval(abs: string, beforeNote: string, afterNote: string): Promise<void> {
        const decision = this.policy.decideFileOp(abs, "write");
        if (decision.action === "deny") {
            this.audit.record({ type: "policy.blocked", action: "fs.write", rule: decision.rule });
            throw new RpcError(RpcErrorCodes.PolicyDenied, decision.reason ?? "策略拒绝", { rule: decision.rule });
        }
        if (decision.action === "require_approval") {
            this.audit.record({ type: "approval.requested", action: `fs.entry ${abs}` });
            const verdict = await this.approvals.request({
                kind: "file_write",
                target: abs,
                detail: {
                    rule: decision.rule,
                    isNewFile: !fs.existsSync(abs),
                    beforePreview: beforeNote,
                    afterPreview: afterNote,
                },
            });
            this.audit.record({
                type: verdict.approved ? "approval.granted" : "approval.denied",
                action: `fs.entry ${abs}`,
                reason: verdict.reason,
            });
            if (!verdict.approved)
                throw new RpcError(RpcErrorCodes.ApprovalDenied, verdict.reason ?? "用户拒绝该操作");
        }
    }
}
