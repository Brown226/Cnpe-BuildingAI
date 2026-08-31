/** jiti-only 编译变体：跳过 pty，纯验证 jiti 在 bun compile 产物内动态加载磁盘 TS */
import { createRequire } from "node:module";
import path from "node:path";

async function main(): Promise<void> {
    console.log("[2] jiti 动态加载磁盘 TS 扩展…");
    // bun compile 内 import.meta.dir 是虚拟路径 B:/~BUN/root，必须用 process.execPath 定位真实目录
    const exeDir = path.dirname(process.execPath);
    const pluginPath = path.join(exeDir, "dynamic-plugin.ts");
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url);
    const mod = (await jiti.import(pluginPath)) as { hello?: () => string };
    const jitiOk = mod.hello?.() === "jiti-ok";
    console.log(`    jiti: ${jitiOk ? "PASS" : "FAIL"}`);
    console.log(`[3] platform=${process.platform} node=${process.version} bun=${typeof Bun !== "undefined"}`);
    console.log(`RESULT: pty=skip jiti=${jitiOk ? 1 : 0}`);
    process.exit(jitiOk ? 0 : 1);
}

void main().catch((err) => {
    console.error("FATAL:", err instanceof Error ? err.message : String(err));
    console.log("RESULT: pty=skip jiti=0");
    process.exit(1);
});
