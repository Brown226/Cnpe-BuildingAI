import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type AppMode = "all" | "app" | "admin";

const logger = new Logger("AppMode");

export function getAppMode(): AppMode {
    const raw = (process.env.ADMIN_MODE || "all").trim().toLowerCase();
    return raw === "app" || raw === "admin" ? raw : "all";
}

/**
 * 端分离（ADR-S01）：按 ADMIN_MODE 做进程级请求面隔离。
 * - all   默认/兼容模式，不拦截（单进程全量，行为与改造前一致）
 * - app   业务进程：仅拒绝管理面 /consoleapi
 * - admin 管理进程：仅放行管理面 /consoleapi、健康检查 /health（管理端构建产物就绪后放行静态资源）
 *
 * 必须以中间件实现，且置于 CORS 之后——拦截响应同样要带跨域头
 * （与 Enterprise free mode 的路由拦截约定一致）。
 */
export function installAppModeFilter(app: NestExpressApplication): void {
    const mode = getAppMode();
    if (mode === "all") return;

    const consolePrefix = (process.env.VITE_APP_CONSOLE_API_PREFIX || "consoleapi").replace(
        /^\/+/,
        "",
    );

    if (mode === "app") {
        // 业务进程：黑名单拦截管理面
        app.use((req: Request, res: Response, next: NextFunction) => {
            const path = (req.path || "").replace(/^\/+/, "");
            if (path === consolePrefix || path.startsWith(`${consolePrefix}/`)) {
                res.status(404).json({ statusCode: 404, message: "Not Found" });
                return;
            }
            next();
        });
        logger.log(`app 进程：已屏蔽管理面 /${consolePrefix}/*`);
        return;
    }

    // admin 进程：白名单。注：本文件编译到 dist/common/utils，public 目录计算方式与 app.module 同构（src/modules → dist/modules，向上 4 级；此处更深 1 级，向上 5 级）
    const adminIndexPath = join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "public",
        "admin",
        "index.html",
    );
    const servesAdminStatic = existsSync(adminIndexPath);

    app.use((req: Request, res: Response, next: NextFunction) => {
        const path = (req.path || "").replace(/^\/+/, "");
        const apiOk = path === consolePrefix || path.startsWith(`${consolePrefix}/`);
        const healthOk = path === "health" || path.startsWith("health/");
        if (apiOk || healthOk || servesAdminStatic) {
            next();
            return;
        }
        res.status(404).json({ statusCode: 404, message: "Not Found" });
    });
    logger.log(
        `admin 进程：仅暴露 /${consolePrefix}/* 与 /health${servesAdminStatic ? "（含管理端静态资源）" : ""}`,
    );
}