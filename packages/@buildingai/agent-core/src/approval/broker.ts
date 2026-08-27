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
    kind: string;
    target: string;
    resolve: (value: ApprovalDecisionResult) => void;
    timer: NodeJS.Timeout;
};

const APPROVAL_TIMEOUT_MS = 5 * 60_000;
/** T1.4 doom-loop：同一操作连续拒绝达到上限后，直接拒绝不再弹卡 */
const DOOM_LOOP_LIMIT = 3;

/**
 * 审批中介：把"需要审批的策略决策"转成发给前端的审批卡片事件，
 * 等待用户在 UI 上点击后的 respond 回调。审批状态只在 sidecar
 * 进程内裁决，渲染进程不能注入决定（UI 仅呈现）。
 *
 * T1.4 增强：
 * - once/always：respond(remember=true) 后同 kind+target 自动放行（进程级记忆）
 * - doom-loop：同 kind+target 连续拒绝达上限，后续请求直接拒绝并说明原因
 */
export class ApprovalBroker {
    private readonly pending = new Map<string, Resolver>();
    private readonly allowRules = new Set<string>();
    private readonly denialCounts = new Map<string, number>();

    constructor(private readonly notify: (method: string, params?: unknown) => void) {}

    request(payload: Omit<ApprovalRequestPayload, "requestId" | "timeoutMs">): Promise<ApprovalDecisionResult> {
        const key = this.ruleKey(payload.kind, payload.target);

        // doom-loop：连续拒绝达上限 → 直接拒绝，不再打扰用户（防 agent 死循环重试）
        const denials = this.denialCounts.get(key) ?? 0;
        if (denials >= DOOM_LOOP_LIMIT) {
            return Promise.resolve({
                approved: false,
                reason: `该操作已被连续拒绝 ${denials} 次，已停止尝试；如需执行请告知用户手动操作`,
            });
        }

        // always 记忆：用户选择"总是允许"后同操作自动放行
        if (this.allowRules.has(key)) {
            return Promise.resolve({ approved: true, reason: "remembered" });
        }

        const requestId = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve({ approved: false, reason: "审批超时" });
            }, APPROVAL_TIMEOUT_MS);
            this.pending.set(requestId, { kind: payload.kind, target: payload.target, resolve, timer });
            this.notify("approval/request", {
                requestId,
                kind: payload.kind,
                target: payload.target,
                detail: payload.detail,
                timeoutMs: APPROVAL_TIMEOUT_MS,
            } satisfies ApprovalRequestPayload);
        });
    }

    /**
     * 用户响应审批。
     * @param remember 为 true 且批准时，同 kind+target 在本进程内后续自动放行（"总是允许"）
     */
    respond(requestId: string, approved: boolean, reason?: string, remember = false): boolean {
        const entry = this.pending.get(requestId);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        const key = this.ruleKey(entry.kind, entry.target);
        if (approved) {
            if (remember) this.allowRules.add(key);
            this.denialCounts.delete(key);
        } else {
            this.denialCounts.set(key, (this.denialCounts.get(key) ?? 0) + 1);
        }
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

    /** 诊断：当前 always 放行规则数 */
    allowRuleCount(): number {
        return this.allowRules.size;
    }

    private ruleKey(kind: string, target: string): string {
        return `${kind}\x00${target}`;
    }

    static deniedError(reason: string, code: number = RpcErrorCodes.ApprovalDenied): RpcError {
        return new RpcError(code, reason);
    }
}
