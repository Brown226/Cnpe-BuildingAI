import "@buildingai/config/utils/env";

const setupTime = Date.now();

import { AppConfig } from "@buildingai/config/app.config";
import { setStackFinderFn } from "@buildingai/core/modules";
import { FileUrlService } from "@buildingai/db";
import { NestContainer } from "@buildingai/di";
import { findStackTargetFile, isDevelopment, printBrandLogo } from "@buildingai/utils";
import { setAssetsDir, tryListen } from "@common/utils/system";
import { HttpLoggerInterceptor, LoggerModule } from "@core/logger";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import bodyParser from "body-parser";
import bodyParserXml from "body-parser-xml";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";

setStackFinderFn(findStackTargetFile);

import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { AppModule } from "./modules/app.module";

/**
 * Bootstrap the application
 */
async function bootstrap() {
    const dynamicAppModule = await AppModule.register();

    const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 4090;

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
    console.error("Unhandled promise rejection:", reason);
    console.error("Promise:", promise);
    if (process.env.NODE_ENV === "production") {
        console.error(
            "Unhandled promise rejection detected in production environment, please inspect the code",
        );
    }
});

if (isDevelopment()) {
    printBrandLogo();
}

void bootstrap();
