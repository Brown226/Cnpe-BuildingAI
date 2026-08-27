import { randomUUID } from "node:crypto";
import { RpcError, RpcErrorCodes } from "../protocol/messages.js";

export interface ApprovalRequestPayload {
    requestId: string;
    kind: "command" | "file_write" | "file_delete";
    target: string;
    detail: Record<string, unknown>;
    timeoutMs: number;
}

export interface ApprovalDecisionResult {
    approved: boolean;
    reason?: string;
}

type Resolver = {
    resolve: (value: ApprovalDecisionResult) => void;
    timer: NodeJS.Timeout;
};

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * 审批中介：把"需要审批的策略决策"转成发给前端的审批卡片事件，
 * 等待用户在 UI 上点击后的 respond 回调。审批状态只在 sidecar
 * 进程内裁决，渲染进程不能注入决定（UI 仅呈现）。
 */
export class ApprovalBroker {
    private readonly pending = new Map<string, Resolver>();

    constructor(private readonly notify: (method: string, params?: unknown) => void) {}

    request(payload: Omit<ApprovalRequestPayload, "requestId" | "timeoutMs">): Promise<ApprovalDecisionResult> {
        const requestId = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve({ approved: false, reason: "审批超时" });
            }, APPROVAL_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, timer });
            this.notify("approval/request", {
                requestId,
                kind: payload.kind,
                target: payload.target,
                detail: payload.detail,
                timeoutMs: APPROVAL_TIMEOUT_MS,
            } satisfies ApprovalRequestPayload);
        });
    }

    respond(requestId: string, approved: boolean, reason?: string): boolean {
        const entry = this.pending.get(requestId);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        entry.resolve({ approved, reason });
        return true;
    }

    /** 强制否决所有等待中的审批（sidecar 停机时调用） */
    rejectAll(reason = "会话结束"): void {
        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.resolve({ approved: false, reason });
        }
        this.pending.clear();
    }

    static deniedError(reason: string, code: number = RpcErrorCodes.ApprovalDenied): RpcError {
        return new RpcError(code, reason);
    }
}
