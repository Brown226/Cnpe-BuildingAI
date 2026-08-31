/**
 * Y1 重复错误熔断（借鉴 Yan-Agent opencode-sidecar 的错误收尾策略）。
 *
 * 同一会话内同类错误连续重复达到阈值时置 tripped——调用方据此停止自动重试，
 * 进入可见错误收尾，避免无限消耗 token。签名对消息做归一化（数字/UUID/空白折叠），
 * 使 "connection refused :5371" 与 ":5372" 视为同类。
 *
 * 纯逻辑模块，无副作用；PiEngine 在每个回合边界调用。
 */
export interface BreakerState {
    /** 达到阈值（本次调用已熔断） */
    tripped: boolean;
    /** 当前连续同类错误次数（tripped 时即阈值；之后自动清零重计） */
    count: number;
    threshold: number;
}

export class ErrorCircuitBreaker {
    private entries = new Map<string, { signature: string; count: number }>();

    constructor(readonly threshold = 3) {}

    /**
     * 记录一次错误。返回当前状态；tripped=true 表示已达到熔断阈值
     * （调用方应把错误标记为不可恢复并停止重试），随后计数自动清零。
     */
    record(key: string, rawMessage: string): BreakerState {
        const signature = ErrorCircuitBreaker.normalize(rawMessage);
        const entry = this.entries.get(key);
        const count = entry && entry.signature === signature ? entry.count + 1 : 1;
        if (count >= this.threshold) {
            this.entries.delete(key);
            return { tripped: true, count, threshold: this.threshold };
        }
        this.entries.set(key, { signature, count });
        return { tripped: false, count, threshold: this.threshold };
    }

    /** 回合成功后清零（错误序列被打断即重新计数） */
    reset(key: string): void {
        this.entries.delete(key);
    }

    /** 错误签名归一化：小写、数字/UUID 折叠为 #、空白收敛、截断 200 字符 */
    static normalize(raw: string): string {
        return String(raw ?? "")
            .toLowerCase()
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
            .replace(/\d+/g, "#")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);
    }
}
