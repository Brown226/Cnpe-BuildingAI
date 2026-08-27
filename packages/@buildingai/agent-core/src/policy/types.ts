import { RpcError, RpcErrorCodes } from "../protocol/messages.js";

export type PermissionMode = "strict" | "balanced" | "trust";

export interface PolicyConfig {
    mode: PermissionMode;
    /** 危险命令黑名单（正则源字符串，大小写不敏感） */
    commandBlacklist: string[];
    /** 平衡模式下允许自动执行的命令白名单（正则源字符串） */
    commandWhitelist: string[];
}

export interface Decision {
    action: "allow" | "deny" | "require_approval";
    /** 命中规则标识，写入审计流水 */
    rule: string;
    reason?: string;
}

export const DEFAULT_MODE: PermissionMode = "balanced";

/**
 * 默认危险命令黑名单 —— 任何权限模式下硬拒绝并强制上报。
 * 服务端配置包可追加条目（追加不覆盖）。
 */
export const DEFAULT_COMMAND_BLACKLIST: string[] = [
    // 递归强删
    "\\brm\\b[^|;&\\n]{0,200}\\s(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\\b",
    "\\bdel\\s+(\\/f[\\s/]|\\/s[\\s/]|\\/q[\\s/])+",
    "\\brd\\s+\\/s(?!\\s*[^\\s])",
    "remove-item[^|;\\n]{0,120}-recurse[^|;\\n]{0,60}-force",
    // 磁盘级破坏
    "\\b(format|diskpart|cipher|defrag)\\s+[a-z]:",
    "\\bmkfs(\\.\\w+)?\\b",
    "\\bdd\\s+if=",
    "[>]{1,2}\\s*\\/dev\\/(sd[a-z]|nvme|vd[a-z])",
    // 系统篡改
    "\\bvssadmin\\b[^\\n]*\\bdelete\\b",
    "\\bbcdedit\\b",
    "\\bshutdown\\b([^-]|$)|^shutdown\\b",
    "\\breboot\\b|^reboot\\b",
    "\\breg(\\.exe)?\\s+(delete|add|import|restore)\\b",
    "\\bschtasks\\s+\\/(create|delete|change)\\b",
    "\\bnet\\s+user\\b",
    "\\bicacls\\b.{0,80}\\/(grant|reset)",
    // 凭证窃取与混淆执行
    "-encodedcommand\\b",
    "\\bmimikatz\\b",
    "\\.ssh\\/.{0,40}(authorized_keys|id_rsa)",
    "(appdata|users)[\\\\/].{0,40}secrets?.dat",
];

/**
 * 平衡模式默认白名单：常见只读 / 构建类操作自动放行。
 * 首个 token 匹配；管理员可在服务端调整。
 */
export const DEFAULT_COMMAND_WHITELIST: string[] = [
    "^git\\s+(status|log|diff|show|branch|blame|stash(\\s+list)?$|pull|fetch)",
    "^(pnpm|npm|yarn|bun)\\s+(test|lint|build|run\\s+test|run\\s+lint|typecheck|check-types)\\b",
    "^(ls|dir|pwd|tree)(\\s|$)",
    "^(cat|type|head|tail)(\\s+\\S+)(\\s|$)?",
    "^(findstr|grep|rg)(\\s|$)",
    "^(which|where|whoami)(\\s|$)",
    "^echo\\s",
    "^mkdir\\s+\\S+$",
];
