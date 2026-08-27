import { spawn } from "node:child_process";
import { RpcError, RpcErrorCodes } from "../protocol/messages.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ApprovalBroker } from "../approval/broker.js";
import type { AuditCollector } from "../audit/collector.js";

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ExecResult {
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncated: boolean;
    decisionRule: string;
    durationMs: number;
}

/**
 * 受控命令执行（风险清单中的最高优先缓解点）：
 * 1. cwd 必须在工作区内（硬规则）
 * 2. 黑名单硬拒绝并上报（任何权限模式不可绕过）
 * 3. 白名单外按三级模式决定放行或弹审批
 * 4. 超时强杀进程树、输出截断，防挂死与刷屏
 */
export class CommandExecutor {
    constructor(
        private readonly policy: PolicyEngine,
        private readonly approvals: ApprovalBroker,
        private readonly audit: AuditCollector,
    ) {}

    async run(commandLine: string, cwd: string): Promise<ExecResult> {
        const started = Date.now();
        const decision = this.policy.decideCommand(commandLine, cwd);

        if (decision.action === "deny") {
            this.audit.record({
                type: "policy.blocked",
                action: commandLine.slice(0, 500),
                rule: decision.rule,
                detail: { cwd },
            });
            throw new RpcError(RpcErrorCodes.PolicyDenied, decision.reason ?? "策略拒绝该命令", {
                rule: decision.rule,
            });
        }

        if (decision.action === "require_approval") {
            this.audit.record({ type: "approval.requested", action: commandLine.slice(0, 500) });
            const verdict = await this.approvals.request({
                kind: "command",
                target: commandLine.slice(0, 200),
                detail: { cwd, rule: decision.rule },
            });
            this.audit.record({
                type: verdict.approved ? "approval.granted" : "approval.denied",
                action: commandLine.slice(0, 500),
            });
            if (!verdict.approved)
                throw new RpcError(RpcErrorCodes.ApprovalDenied, verdict.reason ?? "用户拒绝执行");
        }

        return new Promise<ExecResult>((resolve, reject) => {
            // shell:true 与策略的正则匹配保持同一解释语义
            const child = spawn(commandLine, {
                shell: true,
                cwd,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";
            let truncated = false;
            let timedOut = false;
            let settled = false;

            const collect = (chunk: Buffer, isStdout: boolean) => {
                if (truncated) return;
                const next =
                    (isStdout ? stdout : stderr).length + chunk.length > MAX_OUTPUT_BYTES;
                if (next) {
                    truncated = true;
                    const room = MAX_OUTPUT_BYTES - (isStdout ? stdout : stderr).length;
                    const part = chunk.toString("utf8", 0, Math.max(room, 0));
                    if (isStdout) stdout += part;
                    else stderr += part;
                    return;
                }
                if (isStdout) stdout += chunk.toString("utf8");
                else stderr += chunk.toString("utf8");
            };

            child.stdout?.on("data", (c: Buffer) => collect(c, true));
            child.stderr?.on("data", (c: Buffer) => collect(c, false));

            const timer = setTimeout(() => {
                timedOut = true;
                killTree(child.pid);
            }, DEFAULT_TIMEOUT_MS);

            child.on("error", (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new RpcError(RpcErrorCodes.InternalError, `进程启动失败：${err.message}`));
            });

            child.on("close", (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const result: ExecResult = {
                    exitCode: code,
                    timedOut,
                    stdout: appendTruncation(stdout, truncated),
                    stderr: timedOut ? `${stderr}\n[agent-core] 命令超时已被强制终止`.trim() : stderr,
                    truncated,
                    decisionRule: decision.rule,
                    durationMs: Date.now() - started,
                };
                this.audit.record({
                    type: "tool.call",
                    action: commandLine.slice(0, 500),
                    rule: decision.rule,
                    detail: {
                        cwd,
                        exitCode: code,
                        timedOut,
                        durationMs: result.durationMs,
                    },
                });
                resolve(result);
            });
        });
    }
}

function killTree(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
        try {
            process.kill(-pid, "SIGKILL");
        } catch {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                /* 已退出 */
            }
        }
    }
}

function appendTruncation(text: string, truncated: boolean): string {
    return truncated ? `${text}\n[agent-core] 输出已截断` : text;
}
