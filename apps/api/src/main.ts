import { Logger, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";

import { AppModule } from "#src/app.module";

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
        bufferLogs: true,
    });
    const config = app.get(ConfigService);
    const bodyLimit = config.getOrThrow<number>("HTTP_BODY_LIMIT_BYTES");
    app.useBodyParser("json", { limit: bodyLimit });
    app.useBodyParser("urlencoded", { extended: true, limit: bodyLimit });
    app.use(helmet());
    app.enableCors({
        origin: config.getOrThrow<string[]>("CORS_ORIGINS"),
        credentials: true,
    });
    app.enableShutdownHooks();
    app.setGlobalPrefix("api");
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: "1",
    });

    const openApiConfig = new DocumentBuilder()
        .setTitle("Kinetix API")
        .setDescription("HTTP API for the Kinetix platform")
        .setVersion("1.0")
        .build();
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup("api/docs", app, document);

    const host = config.getOrThrow<string>("HOST");
    const port = config.getOrThrow<number>("PORT");
    await app.listen(port, host);

    Logger.log(`API listening at http://${host}:${port}/api/v1`, "Bootstrap");
}

void bootstrap();
