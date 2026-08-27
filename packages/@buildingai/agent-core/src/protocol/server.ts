import { createInterface } from "node:readline";
import process from "node:process";
import type { JsonRpcErrorObject, JsonRpcResponse, RpcId } from "./messages.js";

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * 行分隔 JSON-RPC over stdio。
 * stdout 是唯一的 RPC 出口：本进程内任何代码不得直接 console.log 到 stdout。
 * 日志一律走 stderr。
 */
export class RpcServer {
    private readonly handlers = new Map<string, RpcHandler>();
    private notificationHandlers = new Map<string, (params: unknown) => void>();
    private running = false;

    register(method: string, handler: RpcHandler): this {
        this.handlers.set(method, handler);
        return this;
    }

    onNotification(method: string, handler: (params: unknown) => void): this {
        this.notificationHandlers.set(method, handler);
        return this;
    }

    listen(): void {
        if (this.running) return;
        this.running = true;
        const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
        rl.on("line", (line) => this.handleLine(line));
        rl.on("close", () => this.running && process.exit(0));
        writeLine({ jsonrpc: "2.0", id: -1, result: { ready: true, pid: process.pid } });
    }

    notify(method: string, params?: unknown): void {
        writeLine({ jsonrpc: "2.0", method, params });
    }

    private async handleLine(line: string): Promise<void> {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            // 无法提取 id，只能丢弃并记录
            logStderr("rpc: 无法解析的行");
            return;
        }

        const msg = parsed as { jsonrpc?: string; id?: RpcId; method?: string; params?: unknown };

        if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
            this.respondError(msg?.id as RpcId | undefined ?? -1, {
                code: -32600,
                message: "无效请求",
            });
            return;
        }

        // 通知（无 id）：路由给通知处理器后即返回
        if (msg.id === undefined) {
            const nh = this.notificationHandlers.get(msg.method);
            try {
                nh?.(msg.params);
            } catch (err) {
                logStderr(`通知处理失败 ${msg.method}: ${String(err)}`);
            }
            return;
        }

        const handler = this.handlers.get(msg.method);
        if (!handler) {
            this.respondError(msg.id, {
                code: -32601,
                message: `未知方法: ${msg.method}`,
            });
            return;
        }

        try {
            const result = await handler(msg.params);
            this.respond(msg.id, result);
        } catch (err) {
            const isRpcError =
                err instanceof Error &&
                (err as Error & { code?: number }).code !== undefined &&
                err.name === "RpcError";
            const e = err as Error & { code?: number; data?: unknown };
            this.respondError(msg.id, {
                code: isRpcError ? e.code! : -32603,
                message: e.message || String(err),
                data: isRpcError ? e.data : undefined,
            });
        }
    }

    respond(id: RpcId, result: unknown): void {
        writeLine({ jsonrpc: "2.0", id, result });
    }

    respondError(id: RpcId, error: JsonRpcErrorObject): void {
        writeLine({ jsonrpc: "2.0", id, error });
    }
}

function writeLine(payload: JsonRpcResponse | { jsonrpc: "2.0"; method: string; params?: unknown }): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function logStderr(message: string): void {
    process.stderr.write(`[agent-core] ${message}\n`);
}
