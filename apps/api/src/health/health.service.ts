import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { HealthResponse } from "@kinetix/types";

import { DatabaseService } from "#src/database/database.service.js";

@Injectable()
export class HealthService {
    constructor(private readonly database: DatabaseService) {}

    getHealth(): HealthResponse {
        return {
            status: "ok",
            service: "kinetix-api",
            timestamp: new Date().toISOString(),
        };
    }

    async getReadiness(): Promise<HealthResponse> {
        await this.database.db.execute(sql`select 1`);
        return this.getHealth();
    }
}
