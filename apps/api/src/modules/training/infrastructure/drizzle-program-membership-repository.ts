import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import {
    plannedSessionBlocks,
    plannedSessions,
    programPlannedSessions,
    sessionMappings,
    trainingSessions,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type {
    ProgramMembershipRepository,
    ProgramSessionLinkInput,
    ProgramSessionMembership,
} from "#src/modules/training/application/index";
import type { PlannedSessionSchedule } from "#src/modules/training/domain/index";
import {
    plannedSessionStatuses,
    trainingSessionStatuses,
    type PlannedSessionStatus,
    type TrainingSessionStatus,
} from "#src/modules/training/domain/index";

/** Reverse `session_mappings` link: the performed session a planned session points forward to. */
interface ActualSessionLink {
    readonly actualSessionId: string;
    readonly actualSessionStatus: TrainingSessionStatus;
}

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
        const executor = this.executor(transaction);
        const rows = await executor
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
        const actualByPlanned = await this.resolveActualSessions(
            rows.map(row => row.plannedSessionId),
            executor,
        );
        return rows.map(row => {
            const actual = actualByPlanned.get(row.plannedSessionId) ?? null;
            return {
                plannedSessionId: row.plannedSessionId,
                sequence: row.sequence,
                relativeWeek: row.relativeWeek,
                relativeDay: row.relativeDay,
                localDate: row.localDate,
                preferredTime: row.preferredTime,
                status: checkedStatus(row.status),
                title: row.title,
                actualSessionId: actual?.actualSessionId ?? null,
                actualSessionStatus: actual?.actualSessionStatus ?? null,
            };
        });
    }

    /**
     * Resolve the performed session each planned session points forward to, in one batched query
     * (design 11.4, UX4). Mappings are recorded on the actual side, so this walks `session_mappings`
     * in reverse and joins the owning training session for its lifecycle status. When several actuals
     * map to one planned session the winner is deterministic: a live (non-archived) session beats an
     * archived one, then the most recently created mapping wins — so re-doing a workout links to the
     * latest attempt, and an archived-only link still resolves rather than vanishing.
     */
    private async resolveActualSessions(
        plannedSessionIds: readonly string[],
        executor: Database,
    ): Promise<ReadonlyMap<string, ActualSessionLink>> {
        const resolved = new Map<string, ActualSessionLink>();
        if (plannedSessionIds.length === 0) return resolved;
        const rows = await executor
            .select({
                plannedSessionId: sessionMappings.plannedSessionId,
                actualSessionId: sessionMappings.sessionId,
                actualSessionStatus: trainingSessions.status,
                archivedAt: trainingSessions.archivedAt,
                createdAt: sessionMappings.createdAt,
            })
            .from(sessionMappings)
            .innerJoin(trainingSessions, eq(sessionMappings.sessionId, trainingSessions.id))
            .where(inArray(sessionMappings.plannedSessionId, [...new Set(plannedSessionIds)]));
        const bestRank = new Map<string, { readonly archived: boolean; readonly createdAt: Date }>();
        for (const row of rows) {
            if (row.plannedSessionId === null) continue;
            const archived = row.archivedAt !== null;
            const current = bestRank.get(row.plannedSessionId);
            // Prefer non-archived; among equal archival state, the most recent mapping wins.
            const wins =
                current === undefined ||
                (current.archived && !archived) ||
                (current.archived === archived && row.createdAt.getTime() > current.createdAt.getTime());
            if (!wins) continue;
            bestRank.set(row.plannedSessionId, { archived, createdAt: row.createdAt });
            resolved.set(row.plannedSessionId, {
                actualSessionId: row.actualSessionId,
                actualSessionStatus: checkedSessionStatus(row.actualSessionStatus),
            });
        }
        return resolved;
    }

    async listProfileScheduledSessions(
        profileId: string,
        transaction?: unknown,
    ): Promise<readonly PlannedSessionSchedule[]> {
        const rows = await this.executor(transaction)
            .selectDistinct({
                id: plannedSessions.id,
                localDate: plannedSessions.localDate,
                preferredTime: plannedSessions.preferredTime,
            })
            .from(plannedSessions)
            .where(and(eq(plannedSessions.profileId, profileId), isNotNull(plannedSessions.localDate)));
        return rows.map(row => ({ id: row.id, localDate: row.localDate, preferredTime: row.preferredTime }));
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

function checkedSessionStatus(value: string): TrainingSessionStatus {
    return (trainingSessionStatuses as readonly string[]).includes(value)
        ? (value as TrainingSessionStatus)
        : (() => {
              throw new Error(`Invalid persisted training session status: ${value}`);
          })();
}
