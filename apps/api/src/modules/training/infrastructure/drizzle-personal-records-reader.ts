import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import {
    exerciseOccurrences,
    exerciseRelationships,
    sessionActivities,
    trainingProfiles,
    trainingSessions,
    type Database,
} from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_SESSION_REPOSITORY,
    type PersonalRecordsReader,
    type TrainingSessionRepository,
} from "#src/modules/training/application/index";
import { entityId } from "#src/platform/domain/index";

import {
    ESTIMATED_1RM_DEFAULT_REP_CUTOFF,
    ESTIMATED_1RM_DEFAULT_REP_MIN,
    type PersonalRecordsConfig,
    type RecordSetInput,
    type SessionActivityState,
} from "#src/modules/training/domain/index";

/**
 * Bounded read adapter that assembles the eligible history the personal-record computation scores
 * (issue #45, A3; design §16.8). It composes the training-session repository (frozen historical snapshots
 * and performed sets) with direct reads of the exercise analytics-family relationships and the profile's 1RM
 * repetition cutoff. Records reflect the as-performed definition, so only the historical snapshot is used and
 * only completed, non-archived sessions feed the history. Drizzle rows never escape here.
 */
@Injectable()
export class DrizzlePersonalRecordsReader implements PersonalRecordsReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly sessions: Pick<TrainingSessionRepository, "readSession">,
    ) {}

    async describeSession(
        sessionId: string,
        transaction?: unknown,
    ): Promise<{ profileId: string; exerciseIds: readonly string[] } | null> {
        const resource = await this.sessions.readSession(entityId(sessionId), transaction);
        if (resource === null) return null;
        return { profileId: resource.profileId, exerciseIds: exerciseIdsOf(resource.activities) };
    }

    /** Current analytics-family members of an exercise (both relationship directions, non-archived) plus self. */
    async familyMembers(exerciseId: string, transaction?: unknown): Promise<readonly string[]> {
        const rows = await this.executor(transaction)
            .select({
                source: exerciseRelationships.sourceExerciseId,
                target: exerciseRelationships.targetExerciseId,
            })
            .from(exerciseRelationships)
            .where(
                and(
                    eq(exerciseRelationships.type, "analytics_family"),
                    isNull(exerciseRelationships.archivedAt),
                    or(
                        eq(exerciseRelationships.sourceExerciseId, exerciseId),
                        eq(exerciseRelationships.targetExerciseId, exerciseId),
                    ),
                ),
            );
        const members = new Set<string>([exerciseId]);
        for (const row of rows) {
            members.add(row.source);
            members.add(row.target);
        }
        return [...members];
    }

    async loadConfig(profileId: string, transaction?: unknown): Promise<PersonalRecordsConfig> {
        const [row] = await this.executor(transaction)
            .select({ repCutoff: trainingProfiles.oneRepMaxRepCutoff })
            .from(trainingProfiles)
            .where(eq(trainingProfiles.profileId, profileId))
            .limit(1);
        return {
            repMin: ESTIMATED_1RM_DEFAULT_REP_MIN,
            repCutoff: row?.repCutoff ?? ESTIMATED_1RM_DEFAULT_REP_CUTOFF,
        };
    }

    async loadEligibleSets(
        profileId: string,
        exerciseIds: readonly string[],
        transaction?: unknown,
    ): Promise<readonly RecordSetInput[]> {
        if (exerciseIds.length === 0) return [];
        const sessionRows = await this.executor(transaction)
            .selectDistinct({ id: trainingSessions.id })
            .from(exerciseOccurrences)
            .innerJoin(sessionActivities, eq(exerciseOccurrences.activityId, sessionActivities.id))
            .innerJoin(trainingSessions, eq(sessionActivities.sessionId, trainingSessions.id))
            .where(
                and(
                    eq(trainingSessions.profileId, profileId),
                    eq(trainingSessions.status, "completed"),
                    isNull(trainingSessions.archivedAt),
                    inArray(exerciseOccurrences.exerciseId, [...exerciseIds]),
                ),
            );

        const targets = new Set(exerciseIds);
        const sets: RecordSetInput[] = [];
        for (const { id } of sessionRows) {
            const resource = await this.sessions.readSession(entityId(id), transaction);
            if (resource === null || resource.status !== "completed" || resource.archivedAt !== null) continue;
            for (const activity of resource.activities) {
                for (const occurrence of activity.strength?.occurrences ?? []) {
                    if (!targets.has(occurrence.exerciseId)) continue;
                    for (const set of occurrence.performedSets) {
                        sets.push({
                            sessionId: resource.id,
                            sessionVersion: resource.version,
                            localDate: resource.localDate,
                            exerciseId: occurrence.exerciseId,
                            exerciseVersion: occurrence.snapshot.exerciseVersion,
                            loadModel: occurrence.snapshot.loadModel,
                            repetitionSemantics: occurrence.snapshot.repetitionSemantics,
                            set,
                        });
                    }
                }
            }
        }
        return sets;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/** Distinct exercise ids a session's strength activities touched (drives the affected record scopes). */
function exerciseIdsOf(activities: readonly SessionActivityState[]): string[] {
    const ids = new Set<string>();
    for (const activity of activities)
        for (const occurrence of activity.strength?.occurrences ?? []) ids.add(occurrence.exerciseId);
    return [...ids];
}
