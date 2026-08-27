import { existsSync, readdirSync } from "node:fs";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";

const requiredVersion = 22;
const currentVersion = process.version.match(/^v(\d+)/)[1];

if (Number(currentVersion) < requiredVersion) {
    console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.red(`✖ Node.js v${requiredVersion} or higher is required`));
    console.log(chalk.red(`✖ Current version: ${process.version}`));
    console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    process.exit(1);
}

const rootDir = path.resolve(import.meta.dirname, "..");
// 端分离(ADR-S03)：RELEASE_TARGET=admin 时发布管理端构建产物到 public/admin，默认发布 C 端到 public/web
const target = process.env.RELEASE_TARGET || "web";
const distPath = path.resolve(
    rootDir,
    target === "admin" ? "packages/admin/dist" : "packages/client/dist",
);
const releasePath = path.resolve(rootDir, target === "admin" ? "public/admin" : "public/web");

/**
 * Recursively set directory and file permissions to 0o755 (dirs) / 0o644 (files).
 * Skipped on Windows.
 */
async function setPermissionsRecursively(dirPath) {
    if (process.platform === "win32") return;

    try {
        await chmod(dirPath, 0o755);
        const entries = readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await setPermissionsRecursively(fullPath);
            } else {
                await chmod(fullPath, 0o644);
            }
        }
    } catch (error) {
        console.log(
            chalk.yellow(`Warning: Failed to set permissions: ${dirPath}, error: ${error.message}`),
        );
    }
}

async function release() {
    try {
        console.log(chalk.blue("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
        console.log(chalk.blue("🚀 Starting release process"));
        console.log(chalk.blue(`📂 Source: ${distPath}`));
        console.log(chalk.blue(`📦 Target: ${releasePath}`));
        console.log(chalk.blue("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));

        if (!existsSync(distPath)) {
            console.log(chalk.red("✖ Build output not found: packages/client/dist"));
            console.log(
                chalk.red("✖ Please run `pnpm --filter buildingai-client build:web` first"),
            );
            process.exit(1);
        }

        // Clean target directory
        if (existsSync(releasePath)) {
            console.log(chalk.yellow("🗑  Cleaning target directory..."));
            await rm(releasePath, { recursive: true, force: true });
        }

        // Copy dist -> public/web
        await mkdir(releasePath, { recursive: true });
        await cp(distPath, releasePath, { recursive: true, force: true });

        const files = readdirSync(releasePath);
        console.log(chalk.blue(`� Copied ${files.length} items to public/web`));

        // Set permissions on non-Windows
        if (process.platform !== "win32") {
            console.log(chalk.blue("🔒 Setting file permissions..."));
            await setPermissionsRecursively(releasePath);
        }

        console.log(chalk.green("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
        console.log(chalk.green("✨ Release successful!"));
        console.log(chalk.green(`📦 Output: ${path.relative(rootDir, releasePath)}`));
        console.log(chalk.green("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    } catch (error) {
        console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
        console.log(chalk.red("❌ Release failed"));
        console.log(chalk.red(`💥 ${error.message}`));
        console.log(error.stack);
        console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
        process.exit(1);
    }
}

release();
