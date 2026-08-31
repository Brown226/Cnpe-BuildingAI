/**
 * Y2 高风险命令分类器（移植 Yan-Agent lib/shell-command-risk.js，MIT）。
 *
 * 对 shell 命令行做 Windows 感知的语义风险分级：
 * - 引号/转义感知 tokenizer（含 PowerShell 反引号转义）
 * - wrapper 展开：powershell/bash/wsl 等外壳的 -c/-Command 内嵌命令递归解析
 * - 可执行文件后缀剥离（.exe/.cmd/.bat/.ps1）
 * - 八类高风险判定：提权/文件删除/磁盘与系统/Git 破坏性/容器删除/集群与基础设施/
 *   远程下载执行/动态执行，以及直接写磁盘设备
 *
 * 用途：接入 PolicyEngine（ADR-06）——黑名单仍是硬拦截第一道；分类器补
 * 白名单正则的语义盲区（如白名单 `git .*` 会放行 `git reset --hard`）。
 */

const TOKEN_BOUNDARIES = new Set([" ", "\t", "\r", "\n"]);
const SHELL_OPERATORS = new Set([";", "|", "&", ">", "<", "(", ")"]);
const COMMAND_SEPARATORS = new Set([";", "|", "||", "&", "&&", "(", ")"]);
const COMMAND_WRAPPERS = new Set(["env", "command", "cmd", "powershell", "pwsh", "bash", "sh", "wsl"]);

export interface CommandRisk {
    level: "normal" | "high";
    requiresApproval: boolean;
    category: string;
    reason: string;
}

function tokenizeShellCommand(command: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote = "";
    let escaped = false;

    const pushCurrent = (): void => {
        if (current) tokens.push(current);
        current = "";
    };

    const input = String(command ?? "");
    for (let index = 0; index < input.length; index += 1) {
        const character = input[index]!;
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (quote) {
            if (character === quote) quote = "";
            else if (character === "`") escaped = true;
            else current += character;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "`") {
            escaped = true;
            continue;
        }
        if (TOKEN_BOUNDARIES.has(character)) {
            pushCurrent();
            if (character === "\n" || character === "\r") tokens.push(";");
            continue;
        }
        if (SHELL_OPERATORS.has(character)) {
            pushCurrent();
            const canPair = character === "|" || character === "&" || character === ">" || character === "<";
            if (canPair && input[index + 1] === character) {
                tokens.push(character + character);
                index += 1;
            } else {
                tokens.push(character);
            }
            continue;
        }
        current += character;
    }
    pushCurrent();
    return tokens;
}

function normalizeToken(token: string): string {
    return String(token ?? "").trim().toLowerCase();
}

function commandName(token: string): string {
    const normalized = normalizeToken(token);
    const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    let name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    for (const suffix of [".exe", ".cmd", ".bat", ".ps1"]) {
        if (name.endsWith(suffix)) {
            name = name.slice(0, -suffix.length);
            break;
        }
    }
    return name;
}

/** 展开 powershell -c "..." / bash -c "..." 等外壳内嵌命令（递归 token 化后并入） */
function expandWrappedCommands(tokens: string[]): string[] {
    const expanded = [...tokens];
    for (let index = 0; index < tokens.length - 1; index += 1) {
        const token = normalizeToken(tokens[index]!);
        if (token !== "-c" && token !== "/c" && token !== "-command") continue;
        let segmentStart = index - 1;
        while (segmentStart > 0 && !COMMAND_SEPARATORS.has(normalizeToken(tokens[segmentStart - 1]!))) {
            segmentStart -= 1;
        }
        const wrapper = commandName(tokens[segmentStart]!);
        if (!COMMAND_WRAPPERS.has(wrapper)) continue;
        let segmentEnd = index + 1;
        while (segmentEnd < tokens.length && !COMMAND_SEPARATORS.has(normalizeToken(tokens[segmentEnd]!))) {
            segmentEnd += 1;
        }
        const nested = tokenizeShellCommand(tokens.slice(index + 1, segmentEnd).join(" "));
        if (nested.length > 0) expanded.push(";", ...nested);
    }
    return expanded;
}

interface CommandEntry {
    name: string;
    index: number;
}

function commandEntries(tokens: string[]): CommandEntry[] {
    const entries: CommandEntry[] = [];
    let expectCommand = true;
    for (let index = 0; index < tokens.length; index += 1) {
        const token = normalizeToken(tokens[index]!);
        if (!token) continue;
        if (COMMAND_SEPARATORS.has(token)) {
            expectCommand = true;
            continue;
        }
        if (!expectCommand) continue;
        const name = commandName(token);
        if (!name) continue;
        entries.push({ name, index });
        if (name === "sudo" || name === "doas" || name === "command" || name === "env" || name === "wsl") {
            expectCommand = true;
            continue;
        }
        expectCommand = false;
    }
    return entries;
}

function commandArguments(tokens: string[], index: number): string[] {
    const args: string[] = [];
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const token = normalizeToken(tokens[cursor]!);
        if (COMMAND_SEPARATORS.has(token)) break;
        if (token) args.push(token);
    }
    return args;
}

function includesAny(values: string[], expected: Set<string>): boolean {
    return values.some((value) => expected.has(value));
}

function highRisk(category: string, reason: string): CommandRisk {
    return { level: "high", requiresApproval: true, category, reason };
}

/** 分类一条 shell 命令行：high = 建议审批（任何非 trust 模式不应自动放行） */
export function classifyShellCommand(command: string): CommandRisk {
    const initialTokens = tokenizeShellCommand(command);
    if (initialTokens.length === 0) return highRisk("invalid", "命令为空或无法解析。");

    const tokens = expandWrappedCommands(initialTokens);
    const entries = commandEntries(tokens);
    const names = new Set(entries.map((entry) => entry.name));

    if (names.has("sudo") || names.has("doas") || names.has("runas")) {
        return highRisk("elevation", "命令请求提升系统权限。");
    }

    const destructiveFiles = new Set(["rm", "rmdir", "rd", "del", "erase", "remove-item", "remove-itemproperty"]);
    if (includesAny(
        entries.map((entry) => entry.name),
        destructiveFiles,
    )) {
        return highRisk("file_delete", "命令会删除文件、目录或系统属性。");
    }

    const diskAndSystem = new Set([
        "format",
        "diskpart",
        "dd",
        "clear-disk",
        "initialize-disk",
        "format-volume",
        "shutdown",
        "restart-computer",
        "stop-computer",
        "set-executionpolicy",
        "bcdedit",
        "cipher",
        "reg",
        "sc",
    ]);
    for (const entry of entries) {
        if (entry.name.startsWith("mkfs")) return highRisk("disk", "命令会修改磁盘或文件系统。");
        if (!diskAndSystem.has(entry.name)) continue;
        const args = commandArguments(tokens, entry.index);
        if (entry.name === "reg" && args[0] !== "delete") continue;
        if (entry.name === "sc" && args[0] !== "delete" && args[0] !== "stop") continue;
        return highRisk("system", "命令会修改磁盘、系统配置或电源状态。");
    }

    for (const entry of entries) {
        const args = commandArguments(tokens, entry.index);
        if (entry.name === "git") {
            const operation = args[0] ?? "";
            if (operation === "reset" && args.includes("--hard"))
                return highRisk("git_destructive", "命令会丢弃本地 Git 修改。");
            if (operation === "clean" && args.some((arg) => arg.startsWith("-") && arg.includes("f")))
                return highRisk("git_destructive", "命令会永久删除未跟踪文件。");
            if (operation === "push" && includesAny(args, new Set(["-f", "--force", "--force-with-lease"])))
                return highRisk("git_remote", "命令会强制改写远程 Git 历史。");
            if (operation === "restore" && !args.includes("--staged"))
                return highRisk("git_destructive", "命令可能丢弃本地文件修改。");
            if (operation === "branch" && includesAny(args, new Set(["-d", "--delete"])))
                return highRisk("git_destructive", "命令会删除 Git 分支。");
        }
        if (entry.name === "docker") {
            const operation = args[0] ?? "";
            if (operation === "system" && args[1] === "prune")
                return highRisk("container_delete", "命令会批量删除 Docker 资源。");
            if (operation === "volume" && (args[1] === "rm" || args[1] === "prune"))
                return highRisk("container_delete", "命令会删除 Docker 数据卷。");
        }
        if (entry.name === "kubectl" && args[0] === "delete")
            return highRisk("cluster_delete", "命令会删除集群资源。");
        if (entry.name === "terraform" && args[0] === "destroy")
            return highRisk("infrastructure_delete", "命令会销毁基础设施资源。");
        if (entry.name === "start-process" && args.includes("-verb") && args.includes("runas")) {
            return highRisk("elevation", "命令请求提升系统权限。");
        }
    }

    const hasPipe = tokens.some((token) => token === "|");
    const downloaders = new Set(["curl", "wget", "iwr", "invoke-webrequest"]);
    const interpreters = new Set(["sh", "bash", "powershell", "pwsh", "iex", "invoke-expression"]);
    if (
        hasPipe &&
        includesAny(
            entries.map((entry) => entry.name),
            downloaders,
        ) &&
        includesAny(
            entries.map((entry) => entry.name),
            interpreters,
        )
    ) {
        return highRisk("remote_execution", "命令会下载远程内容并直接执行。");
    }
    if (names.has("invoke-expression") || names.has("iex")) {
        return highRisk("dynamic_execution", "命令会动态执行生成的代码。");
    }

    for (let index = 0; index < tokens.length - 1; index += 1) {
        if (tokens[index] !== ">" && tokens[index] !== ">>") continue;
        const target = normalizeToken(tokens[index + 1]!);
        if (target.startsWith("/dev/sd") || target.startsWith("\\\\.\\physicaldrive")) {
            return highRisk("disk", "命令会直接写入磁盘设备。");
        }
    }

    return { level: "normal", requiresApproval: false, category: "normal", reason: "" };
}
