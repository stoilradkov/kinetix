import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { parseApiEnv } from '@kinetix/config';

import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['.env', '../../.env'],
      isGlobal: true,
      validate: (config: Record<string, unknown>) => parseApiEnv(config),
    }),
    DatabaseModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
