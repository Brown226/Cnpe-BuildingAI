/**
 * 客户端用量兜底上报（网关治理 P0 · A2 客户端侧）。
 *
 * 仅在「开发直连」模式下启用（DEV_MODEL_BASE_URL 直连上游、不经服务端网关），
 * 把 usage 事件补报进服务端 desktop_usage_event（source="client"），
 * 保证计量账本在网关未覆盖的场景下仍有数据。
 *
 * 防重复：生产网关模式下**不启用**本上报——网关请求级计量（source="gateway"）
 * 已覆盖每次调用，客户端再报会双算。审计通道 session.usage（合规口径）始终独立上报。
 *
 * 与 AuditCollector 同构：内存队列 → 批量 POST；失败重排队（带上限）；
 * 服务端不可达时不阻塞本地功能；任何失败静默（计量不得影响对话主链路）。
 */
export interface ClientUsageEvent {
    /** 会话模式：code | work */
    mode?: string;
    /** 实际使用的模型标识 */
    modelId?: string;
    /** 会话标识（服务端截断至 64 字符） */
    sessionId?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}

const MAX_QUEUE = 2000;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 10;
const MAX_REQUEUE = 5;

export class UsageReporter {
    private queue: ClientUsageEvent[] = [];
    private requeues = 0;
    private serverUrl = "";
    private token: string = "";
    private timer: NodeJS.Timeout | null = null;

    /** 配置后启用上报；serverUrl 为空则保持关闭 */
    configure(serverUrl: string, token: string): void {
        if (!serverUrl) return;
        this.serverUrl = serverUrl.replace(/\/+$/, "");
        this.token = token;
        this.startTimer();
    }

    get enabled(): boolean {
        return Boolean(this.serverUrl);
    }

    record(event: ClientUsageEvent): void {
        if (!this.enabled) return;
        this.queue.push({
            ...event,
            inputTokens: Math.max(0, Math.floor(event.inputTokens ?? 0)),
            outputTokens: Math.max(0, Math.floor(event.outputTokens ?? 0)),
            cacheReadTokens: Math.max(0, Math.floor(event.cacheReadTokens ?? 0)),
            cacheWriteTokens: Math.max(0, Math.floor(event.cacheWriteTokens ?? 0)),
        });
        if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
        if (this.queue.length >= FLUSH_THRESHOLD) void this.flush();
    }

    async flush(): Promise<void> {
        if (this.queue.length === 0 || !this.serverUrl) return;
        const batch = this.queue.splice(0, this.queue.length);
        try {
            const res = await fetch(`${this.serverUrl}/api/v1/desktop/usage/batch`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ events: batch }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.requeues = 0;
        } catch {
            // 失败重排队（带上限）：连续失败达到上限后丢弃，避免内存增长
            this.requeues += 1;
            if (this.requeues <= MAX_REQUEUE) {
                this.queue.unshift(...batch.slice(0, MAX_QUEUE));
                if (this.queue.length > MAX_QUEUE)
                    this.queue.splice(0, this.queue.length - MAX_QUEUE);
            }
        }
    }

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        // 退出前尽力冲一次
        void this.flush();
    }

    private startTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
        // 不阻止进程退出
        this.timer.unref?.();
    }
}
