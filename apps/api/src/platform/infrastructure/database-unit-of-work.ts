import { Injectable } from "@nestjs/common";

import { DatabaseService } from "#src/database/database.service";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";

@Injectable()
export class DatabaseUnitOfWork implements UnitOfWork {
    constructor(private readonly database: DatabaseService) {}

    execute<Result>(
        work: (transaction: unknown, context?: CommandContext) => Promise<Result>,
        context?: CommandContext,
    ): Promise<Result> {
        return this.database.db.transaction(transaction => work(transaction, context));
    }
}
