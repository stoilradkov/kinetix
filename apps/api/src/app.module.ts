import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { parseApiEnv } from "@kinetix/config";

import { DatabaseModule } from "#src/database/database.module";
import { HealthController } from "#src/health/health.controller";
import { HealthService } from "#src/health/health.service";
import { HealthDataModule } from "#src/modules/health-data/index";
import { ProfileModule } from "#src/modules/profile/index";
import { TrainingModule } from "#src/modules/training/index";

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
