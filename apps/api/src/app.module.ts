import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { parseApiEnv } from "@kinetix/config";

import { DatabaseModule } from "#src/database/database.module.js";
import { HealthController } from "#src/health/health.controller.js";
import { HealthService } from "#src/health/health.service.js";
import { HealthDataModule } from "#src/modules/health-data/index.js";
import { ProfileModule } from "#src/modules/profile/index.js";
import { TrainingModule } from "#src/modules/training/index.js";

@Module({
    imports: [
        ConfigModule.forRoot({
            cache: true,
            envFilePath: [".env", "../../.env"],
            isGlobal: true,
            validate: (config: Record<string, unknown>) => parseApiEnv(config),
        }),
        DatabaseModule,
        ProfileModule,
        HealthDataModule,
        TrainingModule,
    ],
    controllers: [HealthController],
    providers: [HealthService],
})
export class AppModule {}
