import path from "node:path";
import { DEFAULT_COMMAND_BLACKLIST, DEFAULT_COMMAND_WHITELIST, DEFAULT_MODE } from "./types.js";
import type { Decision, PermissionMode, PolicyConfig } from "./types.js";
import { RpcError, RpcErrorCodes } from "../protocol/messages.js";
import type { WorkspaceStore } from "../workspace/store.js";

interface CompiledRule {
    source: string;
    regex: RegExp;
}

const compile = (patterns: string[]): CompiledRule[] =>
    patterns.map((source) => ({
        source,
        regex: new RegExp(source, "i"),
    }));

/**
 * 策略引擎（ADR-06）：三级权限判定 + 黑名单硬拦截。
 * 规则顺序固定：
 *   1. 命令命中黑名单 → deny（任何模式不可绕过）
 *   2. trust → allow
 *   3. balanced → 白名单 allow / 否则 require_approval
 *   4. strict → require_approval
 * 文件操作是独立硬规则：必须落在工作区白名单内，否则一律 deny。
 */
export class PolicyEngine {
    private mode: PermissionMode = "balanced";
    /** 权限天花板：服务端下发默认档即上限，用户只能向更严方向调整 */
    private ceiling: PermissionMode = DEFAULT_MODE;
    private blacklistRules: CompiledRule[] = compile(DEFAULT_COMMAND_BLACKLIST);
    private whitelistRules: CompiledRule[] = compile(DEFAULT_COMMAND_WHITELIST);
    /** T4.8 出网白名单（域名，支持 *.corp.com 通配；空=不限制） */
    private egressAllowlist: string[] = [];

    constructor(private readonly workspaces: WorkspaceStore) {}

    /** T4.8 设置出网白名单（initialize 下发） */
    setEgressAllowlist(list: string[]): void {
        this.egressAllowlist = (list ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
    }

    /** T4.8 校验目标 URL 是否在白名单内（未配置=放行） */
    decideEgress(rawUrl: string): Decision {
        if (this.egressAllowlist.length === 0) {
            return { action: "allow", rule: "egress_unrestricted" };
        }
        let host: string;
        try {
            host = new URL(rawUrl).hostname.toLowerCase();
        } catch {
            return {
                action: "deny",
                rule: "egress_whitelist",
                reason: `出网白名单无法解析目标地址：${rawUrl}`,
            };
        }
        const allowed = this.egressAllowlist.some((pattern) => {
            const p = pattern.replace(/^\*\./, "");
            return host === p || host.endsWith(`.${p}`);
        });
        return allowed
            ? { action: "allow", rule: "egress_whitelist" }
            : {
                  action: "deny",
                  rule: "egress_whitelist",
                  reason: `出网白名单拒绝访问：${host}`,
              };
    }

    configure(config?: Partial<PolicyConfig>): void {
        if (!config) return;
        if (config.mode) {
            this.mode = config.mode;
            this.ceiling = config.mode;
        }
        // 服务端下发为"追加"，本地默认规则始终生效
        if (config.commandBlacklist?.length)
            this.blacklistRules = [
                ...this.blacklistRules,
                ...compile(config.commandBlacklist),
            ];
        if (config.commandWhitelist?.length)
            this.whitelistRules = [
                ...this.whitelistRules,
                ...compile(config.commandWhitelist),
            ];
    }

    get currentMode(): PermissionMode {
        return this.mode;
    }

    get modeCeiling(): PermissionMode {
        return this.ceiling;
    }

    /** 只允许降档（放宽程度不超过天花板）；违者抛 PolicyDenied */
    setMode(mode: PermissionMode): void {
        if (rank(mode) > rank(this.ceiling)) {
            throw new RpcError(
                RpcErrorCodes.PolicyDenied,
                `权限升级被拒绝：管理员下发的上限为 ${this.ceiling}`,
            );
        }
        this.mode = mode;
    }

    matchBlacklist(commandLine: string): string | null {
        return this.match(this.blacklistRules, commandLine);
    }

    decideFileOp(absPath: string, op: "read" | "write"): Decision {
        const inside = this.workspaces.isInsideWorkspace(absPath);
        if (!inside) {
            return {
                action: "deny",
                rule: "workspace_whitelist",
                reason: `路径不在工作区白名单内：${path.resolve(absPath)}`,
            };
        }
        // 读取在任何模式下都放行（严格模式也只管写操作与命令）
        if (op === "read") return { action: "allow", rule: "file_read_in_workspace" };
        switch (this.mode) {
            case "strict":
                return { action: "require_approval", rule: "mode_strict" };
            // 平衡/信任：工作区内的写入视为白名单命中
            default:
                return { action: "allow", rule: `file_${op}_in_workspace` };
        }
    }

    decideCommand(commandLine: string, cwd: string): Decision {
        const blocked = this.matchBlacklist(commandLine);
        if (blocked) {
            return {
                action: "deny",
                rule: `blacklist:${blocked}`,
                reason: "命令命中危险操作黑名单，已被硬拦截并上报",
            };
        }
        if (!this.workspaces.isInsideWorkspace(cwd)) {
            return {
                action: "deny",
                rule: "exec_cwd_workspace",
                reason: `命令工作目录不在工作区白名单内：${path.resolve(cwd)}`,
            };
        }
        switch (this.mode) {
            case "trust":
                return { action: "allow", rule: "mode_trust" };
            case "strict":
                return { action: "require_approval", rule: "mode_strict" };
            case "balanced": {
                const whitelisted = this.whitelistRules.some((r) => r.regex.test(commandLine.trim()));
                return whitelisted
                    ? { action: "allow", rule: "whitelist_command" }
                    : { action: "require_approval", rule: "mode_balanced_default" };
            }
        }
    }

    private match(rules: CompiledRule[], text: string): string | null {
        for (const r of rules) {
            if (r.regex.test(text)) return r.source;
        }
        return null;
    }
}

const MODE_RANK: Record<PermissionMode, number> = { strict: 1, balanced: 2, trust: 3 };

function rank(mode: PermissionMode): number {
    return MODE_RANK[mode];
}

/** 断言决策非拒绝，供工具实现直接复用 */
export function assertAllowed(decision: Decision, deniedCode: number): void {
    if (decision.action === "deny") {
        throw new RpcError(deniedCode, decision.reason ?? "策略拒绝该操作", { rule: decision.rule });
    }
}
