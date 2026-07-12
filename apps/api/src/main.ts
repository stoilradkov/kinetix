import { Logger, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";

import { AppModule } from "#src/app.module.js";

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const config = app.get(ConfigService);
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
