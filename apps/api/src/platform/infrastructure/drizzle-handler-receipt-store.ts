import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { workHandlerReceipts, type Database } from "@kinetix/db";

import type { HandlerReceiptStore, WorkItemKind } from "#src/platform/application/index";

@Injectable()
export class DrizzleHandlerReceiptStore implements HandlerReceiptStore {
    async has(kind: WorkItemKind, itemId: string, handler: string, transaction: unknown): Promise<boolean> {
        const rows = await this.executor(transaction)
            .select({ itemId: workHandlerReceipts.itemId })
            .from(workHandlerReceipts)
            .where(
                and(
                    eq(workHandlerReceipts.kind, kind),
                    eq(workHandlerReceipts.itemId, itemId),
                    eq(workHandlerReceipts.handler, handler),
                ),
            )
            .limit(1);
        return rows.length === 1;
    }

    async record(
        kind: WorkItemKind,
        itemId: string,
        handler: string,
        handledAt: Date,
        transaction: unknown,
    ): Promise<void> {
        await this.executor(transaction)
            .insert(workHandlerReceipts)
            .values({ kind, itemId, handler, handledAt })
            .onConflictDoNothing();
    }

    private executor(transaction: unknown): Database {
        if (transaction === undefined || transaction === null)
            throw new Error("Handler receipts must be read and written inside a UnitOfWork transaction");
        return transaction as Database;
    }
}
