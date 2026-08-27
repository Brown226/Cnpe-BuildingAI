import "@buildingai/config/utils/env";

const setupTime = Date.now();

import { setStackFinderFn } from "@buildingai/core/modules";
import { findStackTargetFile, isDevelopment, printBrandLogo } from "@buildingai/utils";

setStackFinderFn(findStackTargetFile);

import { FileUrlService } from "@buildingai/db";
import { HttpLoggerInterceptor } from "@core/logger";
import { ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { installAppModeFilter } from "./common/utils/app-mode";
import { createServerApp } from "./common/utils/app-server";
import { setAssetsDir, tryListen } from "./common/utils/system";

/**
 * 管理进程（端分离 ADR-S01）：
 * 仅承载管理面（/consoleapi）与健康检查，白名单隔离；静态资源服务管理端构建产物 public/admin。
 * 端口由 SERVER_ADMIN_PORT 指定（默认 4095）。
 */
async function bootstrap() {
    // 强制管理进程模式：供 app.module 静态目录选择与 installAppModeFilter 白名单使用。
    // 需在 createServerApp（模块装配）之前生效；.env 中的 ADMIN_MODE 不会覆盖已存在的值。
    process.env.ADMIN_MODE = "admin";

    const port = process.env.SERVER_ADMIN_PORT ? parseInt(process.env.SERVER_ADMIN_PORT, 10) : 4095;

    const { app, appLogger } = await createServerApp();

    // 端分离过滤：必须紧跟 createServerApp（位于 CORS 之后），保持拦截响应带跨域头
    installAppModeFilter(app);

    await setAssetsDir(app);

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }),
    );

    app.useGlobalInterceptors(
        new TransformInterceptor(app.get(Reflector), app.get(FileUrlService)),
        new HttpLoggerInterceptor(appLogger),
    );

    app.useGlobalFilters(new HttpExceptionFilter());

    tryListen(app, port, 3, setupTime).catch((err) => {
        console.error("Failed to start service:", err);
        process.exit(1);
    });
}
process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    if (process.env.NODE_ENV === "production") {
        console.error(
            "Uncaught exception detected in production environment, please inspect the code",
        );
    }
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection:", reason);
    console.error("Promise:", promise);
    if (process.env.NODE_ENV === "production") {
        console.error(
            "Unhandled rejection detected in production environment, please inspect the code",
        );
    }
});

if (isDevelopment()) {
    printBrandLogo();
}

void bootstrap();