import type { CommandContext } from "#src/platform/application/command-context";

export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");

export interface UnitOfWork<Transaction = unknown> {
    execute<Result>(
        work: (transaction: Transaction, context?: CommandContext) => Promise<Result>,
        context?: CommandContext,
    ): Promise<Result>;
}
