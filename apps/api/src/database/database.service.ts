import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  createDatabase,
  type Database,
  type DatabaseConnection,
} from '@kinetix/db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly connection: DatabaseConnection;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('DATABASE_URL'));
  }

  get db(): Database {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.client.end({ timeout: 5 });
  }
}
