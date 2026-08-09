import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";

import {
    plannedSessionBlocks,
    prescribedExercises,
    prescribedSets,
    programPlannedSessions,
    trainingSessions,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_SESSION_REPOSITORY,
    type ProgressionContextReader,
    type ProgressionEvaluationSubject,
    type SessionScopeChain,
    type TrainingSessionRepository,
} from "#src/modules/training/application/index";
import type { TrainingSessionState } from "#src/modules/training/domain/index";
import { entityId } from "#src/platform/domain/index";

/**
 * Read adapter that loads a session's identity, completion state, and resolved scope chain plus its
 * full state for pure metric derivation (design §15.3). The scope chain resolves the program/block
 * memberships of the session's planned links and the exercise/set logical keys of the resolved
 * prescriptions, so rule scopes can be matched without the domain touching the database. Drizzle rows
 * never escape this boundary.
 */
@Injectable()
export class DrizzleProgressionContextReader implements ProgressionContextReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly sessions: Pick<TrainingSessionRepository, "readSession">,
    ) {}

    async loadSubject(
        sessionId: string,
        transaction?: unknown,
    ): Promise<{ subject: ProgressionEvaluationSubject; session: TrainingSessionState } | null> {
        const resource = await this.sessions.readSession(entityId(sessionId), transaction);
        if (resource === null) return null;

        const scope = await this.resolveScopeChain(resource, transaction);
        const subject: ProgressionEvaluationSubject = {
            sessionId: resource.id,
            profileId: resource.profileId,
            sessionVersion: resource.version,
            completed: resource.status === "completed" && resource.archivedAt === null,
            scope,
            recoveryIntervalHours: await this.resolveRecoveryIntervalHours(resource, transaction),
            // Baseline weekly volume needs the analytics window not built in the MVP, so it stays absent
            // and the weekly-volume safety policy reports it as a missing input (design §15.4).
            weeklyVolume: null,
        };
        return { subject, session: resource };
    }

    /**
     * Hours between the previous completed session's end and this session's start (design §15.4). Returns
     * `null` when either timestamp is missing, so the minimum-recovery safety policy reports the input as
     * unavailable rather than assuming an interval.
     */
    private async resolveRecoveryIntervalHours(
        resource: TrainingSessionState,
        transaction?: unknown,
    ): Promise<number | null> {
        if (resource.startedAt === null) return null;
        const startedAt = new Date(resource.startedAt);
        const executor = (transaction ?? this.database.db) as Database;
        const previous = (
            await executor
                .select({ endedAt: trainingSessions.endedAt })
                .from(trainingSessions)
                .where(
                    and(
                        eq(trainingSessions.profileId, resource.profileId),
                        eq(trainingSessions.status, "completed"),
                        ne(trainingSessions.id, resource.id),
                        isNotNull(trainingSessions.endedAt),
                        lt(trainingSessions.endedAt, startedAt),
                    ),
                )
                .orderBy(desc(trainingSessions.endedAt))
                .limit(1)
        )[0];
        if (!previous?.endedAt) return null;
        const hours = (startedAt.getTime() - previous.endedAt.getTime()) / 3_600_000;
        return Number.isFinite(hours) && hours >= 0 ? hours : null;
    }

    private async resolveScopeChain(
        resource: TrainingSessionState & { readonly version: number },
        transaction?: unknown,
    ): Promise<SessionScopeChain> {
        const executor = (transaction ?? this.database.db) as Database;
        const plannedSessionIds = [
            ...new Set(
                resource.plannedLinks.map(link => link.plannedSessionId).filter((id): id is string => id !== null),
            ),
        ];
        const resolvedPrescriptionIds = [...new Set(resource.plannedLinks.map(link => link.resolvedPrescriptionId))];

        const [programRows, blockRows, exerciseRows, setRows] = await Promise.all([
            plannedSessionIds.length === 0
                ? []
                : executor
                      .selectDistinct({ programId: programPlannedSessions.programId })
                      .from(programPlannedSessions)
                      .where(inArray(programPlannedSessions.plannedSessionId, plannedSessionIds)),
            plannedSessionIds.length === 0
                ? []
                : executor
                      .selectDistinct({ blockId: plannedSessionBlocks.blockId })
                      .from(plannedSessionBlocks)
                      .where(inArray(plannedSessionBlocks.plannedSessionId, plannedSessionIds)),
            resolvedPrescriptionIds.length === 0
                ? []
                : executor
                      .selectDistinct({ logicalKey: prescribedExercises.logicalKey })
                      .from(prescribedExercises)
                      .where(inArray(prescribedExercises.prescriptionId, resolvedPrescriptionIds)),
            resolvedPrescriptionIds.length === 0
                ? []
                : executor
                      .selectDistinct({ logicalKey: prescribedSets.logicalKey })
                      .from(prescribedSets)
                      .where(inArray(prescribedSets.prescriptionId, resolvedPrescriptionIds)),
        ]);

        return {
            programIds: programRows.map(row => row.programId),
            blockIds: blockRows.map(row => row.blockId),
            templateIds: [],
            exerciseLogicalKeys: exerciseRows.map(row => row.logicalKey),
            setLogicalKeys: setRows.map(row => row.logicalKey),
        };
    }
}
