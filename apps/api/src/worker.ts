import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "#src/app.module";

async function bootstrapWorker(): Promise<void> {
    const application = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    application.enableShutdownHooks();
    Logger.log("Durable worker entrypoint started", "WorkerBootstrap");
}

void bootstrapWorker();
