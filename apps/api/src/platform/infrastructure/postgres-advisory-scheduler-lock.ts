import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DatabaseService } from "#src/database/database.service";
import type { AdvisorySchedulerLock } from "#src/platform/application/index";

@Injectable()
export class PostgresAdvisorySchedulerLock implements AdvisorySchedulerLock {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    withLock(name: string, work: (transaction: unknown) => Promise<void>): Promise<boolean> {
        const normalizedName = name.trim();
        if (normalizedName.length === 0) throw new Error("Scheduler lock name cannot be empty");
        if (normalizedName.length > 180) throw new Error("Scheduler lock name cannot exceed 180 characters");

        return this.database.db.transaction(async transaction => {
            const rows = await transaction.execute<{ acquired: boolean }>(
                sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${normalizedName}, 0)) AS acquired`,
            );
            if (rows[0]?.acquired !== true) return false;
            await work(transaction);
            return true;
        });
    }
}
