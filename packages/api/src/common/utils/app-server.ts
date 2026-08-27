import { AppConfig } from "@buildingai/config/app.config";
import { NestContainer } from "@buildingai/di";
import { LoggerModule } from "@core/logger";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import bodyParser from "body-parser";
import bodyParserXml from "body-parser-xml";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";

import { AppModule } from "../../modules/app.module";

export interface ServerAppHandle {
    app: NestExpressApplication;
    appLogger: ReturnType<typeof LoggerModule.createLogger>;
}

/**
 * 创建 Nest 应用（端分离 ADR-S01，业务进程与管理进程共用）：
 * 模块装配、请求体解析、CORS、企业免费模式拦截。
 * 端口监听与端分离过滤（installAppModeFilter）由各入口完成：main.ts / main-admin.ts。
 */
export async function createServerApp(): Promise<ServerAppHandle> {
    const dynamicAppModule = await AppModule.register();

    const appLogger = LoggerModule.createLogger(AppConfig.name);
    const app = await NestFactory.create<NestExpressApplication>(dynamicAppModule, {
        logger: appLogger,
        bodyParser: false,
    });

    NestContainer.set(app);

    bodyParserXml(bodyParser);

    const bodyLimit = "5mb";

    app.use(
        bodyParser.json({
            limit: bodyLimit,
        }),
    );

    app.use(
        bodyParser.urlencoded({
            extended: true,
            limit: bodyLimit,
        }),
    );

    app.use(
        bodyParser.xml({
            limit: bodyLimit,
            xmlParseOptions: {
                explicitArray: false,
            },
        }),
    );

    app.use(cookieParser());
    app.set("trust proxy", true);

    const corsEnabled = process.env.SERVER_CORS_ENABLED === "true";
    if (corsEnabled) {
        app.enableCors({
            origin: process.env.SERVER_CORS_ORIGIN || "*",
            credentials: true,
        });
        appLogger.log(
            `CORS enabled; allowed origin: ${process.env.SERVER_CORS_ORIGIN || "*"}`,
            "Bootstrap",
        );
    }

    // 企业免费模式（SERVER_BILLING_ENABLED !== "true"）：拦截 C 端商业模块路由，
    // 前缀逻辑与 @WebController/@ConsoleController 装饰器保持一致（可被 env 覆盖）。
    // 必须放在 CORS 之后：拦截响应同样要带跨域头，否则跨源客户端会报 CORS 错误而非 404。
    if (process.env.SERVER_BILLING_ENABLED !== "true") {
        const webPrefix = (process.env.VITE_APP_WEB_API_PREFIX || "api").replace(/^\/+/, "");
        const consolePrefix = (process.env.VITE_APP_CONSOLE_API_PREFIX || "consoleapi").replace(
            /^\/+/,
            "",
        );
        const blockedRoutes = [
            ...["membership", "pay", "recharge", "card-key"].map((p) => `${webPrefix}/${p}`),
            ...[
                "membership-order",
                "plans",
                "levels",
                "card-setting",
                "card-batch",
                "recharge-config",
                "recharge-order",
                "finance",
            ].map((p) => `${consolePrefix}/${p}`),
        ];
        app.use((req: Request, res: Response, next: NextFunction) => {
            const path = (req.path || "").replace(/^\/+/, "");
            if (
                blockedRoutes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
            ) {
                res.status(404).end();
                return;
            }
            next();
        });
        appLogger.log(
            "Enterprise free mode: commercial module routes blocked (set SERVER_BILLING_ENABLED=true to re-enable)",
            "Bootstrap",
        );
    }

    return { app, appLogger };
}