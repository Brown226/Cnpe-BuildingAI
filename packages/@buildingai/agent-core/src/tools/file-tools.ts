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
            if (item.type === "file") {
                try {
                    item.size = fs.statSync(path.join(abs, e.name)).size;
                } catch {
                    /* race，忽略 */
                }
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
        fs.writeFileSync(abs, content, "utf8");
        this.audit.record({
            type: "tool.call",
            action: "fs.write",
            detail: { target: abs, bytesWritten: Buffer.byteLength(content) },
        });
        return { bytesWritten: Buffer.byteLength(content) };
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
}
