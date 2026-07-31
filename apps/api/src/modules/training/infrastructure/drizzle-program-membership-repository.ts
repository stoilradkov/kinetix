import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { plannedSessionBlocks, plannedSessions, programPlannedSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    ProgramMembershipRepository,
    ProgramSessionLinkInput,
    ProgramSessionMembership,
} from "#src/modules/training/application/index";
import { plannedSessionStatuses, type PlannedSessionStatus } from "#src/modules/training/domain/index";

/**
 * Adapter over the membership join tables (design 10.3). Kept separate from the Program and
 * PlannedSession aggregate repositories because a membership row is a relationship, not aggregate
 * state — this is what lets one planned session belong to several programs and blocks at once.
 */
@Injectable()
export class DrizzleProgramMembershipRepository implements ProgramMembershipRepository {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async linkProgramSession(input: ProgramSessionLinkInput, transaction?: unknown): Promise<void> {
        await this.executor(transaction)
            .insert(programPlannedSessions)
            .values({
                programId: input.programId,
                plannedSessionId: input.plannedSessionId,
                relativeWeek: input.relativeWeek ?? null,
                relativeDay: input.relativeDay ?? null,
                sequence: input.sequence,
            })
            .onConflictDoUpdate({
                target: [programPlannedSessions.programId, programPlannedSessions.plannedSessionId],
                set: {
                    relativeWeek: input.relativeWeek ?? null,
                    relativeDay: input.relativeDay ?? null,
                    sequence: input.sequence,
                },
            });
    }

    async unlinkProgramSession(programId: string, plannedSessionId: string, transaction?: unknown): Promise<void> {
        await this.executor(transaction)
            .delete(programPlannedSessions)
            .where(
                and(
                    eq(programPlannedSessions.programId, programId),
                    eq(programPlannedSessions.plannedSessionId, plannedSessionId),
                ),
            );
    }

    async linkSessionBlock(plannedSessionId: string, blockId: string, transaction?: unknown): Promise<void> {
        await this.executor(transaction)
            .insert(plannedSessionBlocks)
            .values({ plannedSessionId, blockId })
            .onConflictDoNothing({
                target: [plannedSessionBlocks.plannedSessionId, plannedSessionBlocks.blockId],
            });
    }

    async unlinkSessionBlock(plannedSessionId: string, blockId: string, transaction?: unknown): Promise<void> {
        await this.executor(transaction)
            .delete(plannedSessionBlocks)
            .where(
                and(
                    eq(plannedSessionBlocks.plannedSessionId, plannedSessionId),
                    eq(plannedSessionBlocks.blockId, blockId),
                ),
            );
    }

    async listProgramSessions(programId: string, transaction?: unknown): Promise<readonly ProgramSessionMembership[]> {
        const rows = await this.executor(transaction)
            .select({
                plannedSessionId: programPlannedSessions.plannedSessionId,
                sequence: programPlannedSessions.sequence,
                relativeWeek: programPlannedSessions.relativeWeek,
                relativeDay: programPlannedSessions.relativeDay,
                localDate: plannedSessions.localDate,
                preferredTime: plannedSessions.preferredTime,
                status: plannedSessions.status,
                title: plannedSessions.title,
            })
            .from(programPlannedSessions)
            .innerJoin(plannedSessions, eq(programPlannedSessions.plannedSessionId, plannedSessions.id))
            .where(eq(programPlannedSessions.programId, programId))
            .orderBy(asc(programPlannedSessions.sequence), asc(programPlannedSessions.plannedSessionId));
        return rows.map(row => ({
            plannedSessionId: row.plannedSessionId,
            sequence: row.sequence,
            relativeWeek: row.relativeWeek,
            relativeDay: row.relativeDay,
            localDate: row.localDate,
            preferredTime: row.preferredTime,
            status: checkedStatus(row.status),
            title: row.title,
        }));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function checkedStatus(value: string): PlannedSessionStatus {
    return (plannedSessionStatuses as readonly string[]).includes(value)
        ? (value as PlannedSessionStatus)
        : (() => {
              throw new Error(`Invalid persisted planned session status: ${value}`);
          })();
}
