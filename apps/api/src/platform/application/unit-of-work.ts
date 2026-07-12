export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");

export interface UnitOfWork<Transaction = unknown> {
    execute<Result>(work: (transaction: Transaction) => Promise<Result>): Promise<Result>;
}
