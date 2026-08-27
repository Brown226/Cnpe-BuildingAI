/**
 * 浏览器桥（T3.6 方案 A）：agent 工具与内嵌浏览器之间的请求-响应通道。
 * agent 请求 → notify browser/request → 前端 invoke Tauri 驱动浏览器 →
 * 前端 respond browser/result → 本桥回填给工具（模型拿到采集结果）。
 */
import { randomUUID } from "node:crypto";

export type BrowserAction = "navigate" | "eval" | "read";

interface Pending {
    resolve: (result: string) => void;
    reject: (err: Error) => void;
}

const REQUEST_TIMEOUT_MS = 15_000;

export class BrowserBridge {
    private readonly pending = new Map<string, Pending>();

    constructor(
        private readonly notify: (method: string, params?: unknown) => void,
    ) {}

    /** 发起浏览器操作并等待前端回传结果 */
    request(action: BrowserAction, payload?: unknown): Promise<string> {
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("浏览器请求超时（15s）"));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, {
                resolve: (r) => {
                    clearTimeout(timer);
                    resolve(r);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });
            this.notify("browser/request", { requestId, action, payload });
        });
    }

    /** 前端回传结果 */
    respond(requestId: string, result?: string, error?: string): boolean {
        const entry = this.pending.get(requestId);
        if (!entry) return false;
        this.pending.delete(requestId);
        if (error) entry.reject(new Error(error));
        else entry.resolve(result ?? "");
        return true;
    }

    /** 停机时拒绝所有等待 */
    rejectAll(reason = "sidecar 停机"): void {
        for (const [, entry] of this.pending) entry.reject(new Error(reason));
        this.pending.clear();
    }
}
