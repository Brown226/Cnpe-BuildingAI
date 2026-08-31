/**
 * 打包 spike 入口 v2（对齐 agent-core 真实用法）：
 * - node-pty 用 createRequire CJS 加载（与 terminal/pty.ts loadPty 一致）；
 * - Windows 用 cmd.exe /d（pickShell 同款，powershell 在 ConPTY 下会崩）；
 * - env 带 TERM/COLORTERM/LANG。
 */
import { createRequire } from "node:module";
import path from "node:path";

interface PtyLike {
    write(data: string): void;
    kill(): void;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number }) => void): void;
}

async function testPty(): Promise<boolean> {
    const req = createRequire(import.meta.url);
    const ptyModule = req("@lydell/node-pty") as {
        spawn(file: string, args: string[], opts: Record<string, unknown>): PtyLike;
    };
    const isWin = process.platform === "win32";
    const shell = isWin ? { file: "cmd.exe", args: ["/d"] } : { file: "bash", args: [] };
    const pty = ptyModule.spawn(shell.file, shell.args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            LANG: isWin ? "zh_CN.UTF-8" : process.env.LANG,
        },
    });
    const out = await new Promise<string>((resolve) => {
        let buf = "";
        const timer = setTimeout(() => resolve(buf), 8000);
        pty.onData((d: string) => {
            buf += d;
            if (buf.includes("SPIKE_PTY_ECHO") || buf.length > 8000) {
                clearTimeout(timer);
                resolve(buf);
            }
        });
        pty.onExit(({ exitCode }) => {
            clearTimeout(timer);
            resolve(`${buf}\n[pty exited ${exitCode}]`);
        });
        pty.write("echo SPIKE_PTY_ECHO\r\n");
    });
    const ok = out.includes("SPIKE_PTY_ECHO");
    console.log(`    node-pty: ${ok ? "PASS" : "FAIL"}`);
    try {
        pty.kill();
    } catch {
        /* 可能已退出 */
    }
    return ok;
}

async function main(): Promise<void> {
    console.log("[1] node-pty（createRequire + cmd.exe）…");
    let ptyOk = false;
    try {
        ptyOk = await testPty();
    } catch (err) {
        console.log(`    node-pty: FAIL (${String(err instanceof Error ? err.message : err).slice(0, 120)})`);
    }

    console.log("[2] jiti 动态加载磁盘 TS 扩展…");
    const pluginPath = path.join(import.meta.dir ?? process.cwd(), "dynamic-plugin.ts");
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url);
    const mod = (await jiti.import(pluginPath)) as { hello?: () => string };
    const jitiOk = mod.hello?.() === "jiti-ok";
    console.log(`    jiti: ${jitiOk ? "PASS" : "FAIL"}`);

    console.log(`[3] platform=${process.platform} node=${process.version} bun=${typeof Bun !== "undefined"}`);
    console.log(`RESULT: pty=${ptyOk ? 1 : 0} jiti=${jitiOk ? 1 : 0}`);
    process.exit(ptyOk && jitiOk ? 0 : 1);
}

void main().catch((err) => {
    console.error("FATAL:", err instanceof Error ? err.message : String(err));
    console.log("RESULT: pty=0 jiti=0");
    process.exit(1);
});
