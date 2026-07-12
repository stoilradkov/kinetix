import { Injectable } from "@nestjs/common";

import { DatabaseService } from "#src/database/database.service.js";
import type { UnitOfWork } from "#src/platform/application/index.js";

@Injectable()
export class DatabaseUnitOfWork implements UnitOfWork {
    constructor(private readonly database: DatabaseService) {}

    execute<Result>(work: (transaction: unknown) => Promise<Result>): Promise<Result> {
        return this.database.db.transaction(transaction => work(transaction));
    }
}
