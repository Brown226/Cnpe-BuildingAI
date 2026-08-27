/**
 * 审计采集器（ADR-07 强制上报部分）：
 * 操作流水/工具调用/审批结果 内存队列 → 批量 POST 服务端。
 * 失败重排队（带上限），服务端不可达时不阻塞本地功能。
 */
export interface AuditEvent {
    at: string;
    userId?: string;
    type:
        | "session.start"
        | "session.end"
        | "tool.call"
        | "policy.blocked"
        | "approval.requested"
        | "approval.granted"
        | "approval.denied";
    action: string;
    rule?: string;
    reason?: string;
    detail?: Record<string, unknown>;
}

const MAX_QUEUE = 5000;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 20;

export class AuditCollector {
    private queue: AuditEvent[] = [];
    private serverUrl = "";
    private token = "";
    private timer: NodeJS.Timeout | null = null;

    configure(serverUrl: string, token: string, userId?: string): void {
        this.serverUrl = serverUrl.replace(/\/+$/, "");
        this.token = token;
        this.userId = userId;
        this.startTimer();
    }

    private userId?: string;

    record(event: Omit<AuditEvent, "at" | "userId">): void {
        this.queue.push({
            ...event,
            at: new Date().toISOString(),
            userId: this.userId,
        });
        if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
        if (this.queue.length >= FLUSH_THRESHOLD) void this.flush();
    }

    async flush(): Promise<void> {
        if (this.queue.length === 0 || !this.serverUrl) return;
        const batch = this.queue.splice(0, this.queue.length);
        try {
            const res = await fetch(`${this.serverUrl}/api/v1/desktop/audit/batch`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ events: batch }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch {
            // 重回队列头部；超限丢最老
            this.queue.unshift(...batch);
            if (this.queue.length > MAX_QUEUE)
                this.queue.splice(0, this.queue.length - MAX_QUEUE);
        }
    }

    startTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
        this.timer.unref();
    }

    /** 停机前尽力同步刷一次 */
    async shutdown(): Promise<void> {
        await this.flush();
        if (this.timer) clearInterval(this.timer);
    }
}
