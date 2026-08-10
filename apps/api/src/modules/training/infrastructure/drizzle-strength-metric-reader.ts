import { Inject, Injectable } from "@nestjs/common";
import { and, between, eq, isNull } from "drizzle-orm";

import { trainingProfiles, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    STRENGTH_METRIC_READER,
    TRAINING_EXERCISE_CATALOG,
    TRAINING_SESSION_REPOSITORY,
    type MetricContextReader,
    type StrengthMetricReader,
    type TrainingExerciseCatalogPort,
    type TrainingSessionRepository,
} from "#src/modules/training/application/index";
import { entityId } from "#src/platform/domain/index";

import {
    STRENGTH_METRIC_DEFAULTS_V1,
    strengthWindowBounds,
    type ExerciseSnapshotV1,
    type MetricTarget,
    type SessionActivityState,
    type StrengthMetricConfig,
    type StrengthOccurrenceFacts,
    type StrengthSessionFacts,
    type StrengthWindowFacts,
    type StrengthWindowKind,
    type StrengthWindowSessionFacts,
} from "#src/modules/training/domain/index";

/**
 * Bounded read adapter that assembles the exact snapshot/latest facts the strength calculators score
 * (issue #44, A2; design §16.4). It composes the training-session repository (the frozen `historical`
 * snapshots, performed sets, session profile/date/version) with the exercise catalog (`currentSnapshot`
 * for the `latest` basis) and direct reads of the training-profile thresholds and the profile's window
 * session list. Only completed, non-archived sessions feed analytics; Drizzle rows never escape here.
 */
@Injectable()
export class DrizzleStrengthMetricReader implements StrengthMetricReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly sessions: Pick<TrainingSessionRepository, "readSession">,
        @Inject(TRAINING_EXERCISE_CATALOG)
        private readonly catalog: Pick<TrainingExerciseCatalogPort, "currentSnapshot">,
    ) {}

    async describeSession(
        sessionId: string,
        transaction?: unknown,
    ): Promise<{ profileId: string; localDate: string } | null> {
        const [row] = await this.executor(transaction)
            .select({ profileId: trainingSessions.profileId, localDate: trainingSessions.localDate })
            .from(trainingSessions)
            .where(eq(trainingSessions.id, sessionId))
            .limit(1);
        return row ?? null;
    }

    async loadSessionFacts(sessionId: string, transaction?: unknown): Promise<StrengthSessionFacts | null> {
        const resource = await this.sessions.readSession(entityId(sessionId), transaction);
        if (resource === null || resource.status !== "completed" || resource.archivedAt !== null) return null;
        const occurrences = await this.occurrenceFacts(resource.activities, new Map());
        return {
            sessionId: resource.id,
            profileId: resource.profileId,
            sessionVersion: resource.version,
            localDate: resource.localDate,
            occurrences,
        };
    }

    async loadConfig(profileId: string, transaction?: unknown): Promise<StrengthMetricConfig> {
        const [row] = await this.executor(transaction)
            .select({
                rpe: trainingProfiles.hardSetRpeThreshold,
                rir: trainingProfiles.hardSetRirThreshold,
                repCutoff: trainingProfiles.oneRepMaxRepCutoff,
                calculatorVersion: trainingProfiles.calculatorVersion,
            })
            .from(trainingProfiles)
            .where(eq(trainingProfiles.profileId, profileId))
            .limit(1);
        if (row === undefined)
            return {
                rpeThreshold: STRENGTH_METRIC_DEFAULTS_V1.rpeThreshold,
                rirThreshold: STRENGTH_METRIC_DEFAULTS_V1.rirThreshold,
                repMin: STRENGTH_METRIC_DEFAULTS_V1.repMin,
                repCutoff: STRENGTH_METRIC_DEFAULTS_V1.repCutoff,
                calculatorVersion: 1,
            };
        return {
            rpeThreshold: Number(row.rpe),
            rirThreshold: row.rir,
            repMin: STRENGTH_METRIC_DEFAULTS_V1.repMin,
            repCutoff: row.repCutoff,
            calculatorVersion: row.calculatorVersion,
        };
    }

    async sessionDatesInRange(
        profileId: string,
        from: string,
        to: string,
        transaction?: unknown,
    ): Promise<readonly string[]> {
        const rows = await this.executor(transaction)
            .selectDistinct({ localDate: trainingSessions.localDate })
            .from(trainingSessions)
            .where(completedInRange(profileId, from, to));
        return rows.map(row => row.localDate);
    }

    async loadWindowFacts(
        profileId: string,
        from: string,
        to: string,
        transaction?: unknown,
    ): Promise<readonly StrengthWindowSessionFacts[]> {
        const rows = await this.executor(transaction)
            .select({ id: trainingSessions.id })
            .from(trainingSessions)
            .where(completedInRange(profileId, from, to));

        const latestCache = new Map<string, ExerciseSnapshotV1 | null>();
        const sessions: StrengthWindowSessionFacts[] = [];
        for (const { id } of rows) {
            const resource = await this.sessions.readSession(entityId(id), transaction);
            if (resource === null || resource.status !== "completed" || resource.archivedAt !== null) continue;
            sessions.push({
                sessionId: resource.id,
                sessionVersion: resource.version,
                localDate: resource.localDate,
                occurrences: await this.occurrenceFacts(resource.activities, latestCache),
            });
        }
        return sessions;
    }

    /** Build per-occurrence facts (historical snapshot + resolved latest definition) for one session. */
    private async occurrenceFacts(
        activities: readonly SessionActivityState[],
        latestCache: Map<string, ExerciseSnapshotV1 | null>,
    ): Promise<StrengthOccurrenceFacts[]> {
        const occurrences: StrengthOccurrenceFacts[] = [];
        for (const activity of activities) {
            for (const occurrence of activity.strength?.occurrences ?? []) {
                const latest = await this.latestSnapshot(occurrence.exerciseId, latestCache);
                occurrences.push({
                    occurrenceId: occurrence.id,
                    exerciseId: occurrence.exerciseId,
                    historicalExerciseVersion: occurrence.snapshot.exerciseVersion,
                    latestExerciseVersion: latest?.exerciseVersion ?? null,
                    historical: occurrence.snapshot,
                    latest,
                    performedSets: occurrence.performedSets,
                });
            }
        }
        return occurrences;
    }

    /** Resolve the current definition snapshot for the latest basis; unavailable definitions yield null. */
    private async latestSnapshot(
        exerciseId: string,
        cache: Map<string, ExerciseSnapshotV1 | null>,
    ): Promise<ExerciseSnapshotV1 | null> {
        const cached = cache.get(exerciseId);
        if (cached !== undefined) return cached;
        let snapshot: ExerciseSnapshotV1 | null;
        try {
            snapshot = await this.catalog.currentSnapshot(exerciseId);
        } catch {
            snapshot = null; // merged/archived/removed definition — no latest basis for this exercise
        }
        cache.set(exerciseId, snapshot);
        return snapshot;
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/** Completed, non-archived sessions for a profile with a local date in the inclusive `[from, to]` range. */
function completedInRange(profileId: string, from: string, to: string) {
    return and(
        eq(trainingSessions.profileId, profileId),
        eq(trainingSessions.status, "completed"),
        isNull(trainingSessions.archivedAt),
        between(trainingSessions.localDate, from, to),
    );
}

/**
 * The composite {@link MetricContextReader} the A1 rebuild framework uses to recompute a single stored
 * strength metric (issue #44, A2). It replaces the A1 `EmptyMetricContextReader`: given a target it
 * dispatches on the scope type — a `session` scope loads the session facts, a `profile-*` window scope
 * loads the window's sessions — and returns them with the profile's versioned config. Discovery of new
 * metrics is the projection use case's job; this reader only reloads facts for an already-known target,
 * returning `null` when the source is gone so the recompute retires the row. The facts and config it
 * returns match the projection path exactly, so both produce the same fingerprint.
 */
@Injectable()
export class DrizzleStrengthMetricContextReader implements MetricContextReader {
    constructor(@Inject(STRENGTH_METRIC_READER) private readonly reader: StrengthMetricReader) {}

    async load(
        _calculatorKey: string,
        target: MetricTarget,
        transaction?: unknown,
    ): Promise<{ facts: unknown; config: Readonly<Record<string, unknown>> } | null> {
        if (target.scope.type === "session") return this.sessionContext(target, transaction);
        const kind = windowKindOf(target.scope.type);
        return kind === null ? null : this.windowContext(kind, target, transaction);
    }

    private async sessionContext(
        target: MetricTarget,
        transaction?: unknown,
    ): Promise<{ facts: StrengthSessionFacts; config: Readonly<Record<string, unknown>> } | null> {
        const facts = await this.reader.loadSessionFacts(target.scope.id, transaction);
        if (facts === null) return null;
        return { facts, config: configRecord(await this.reader.loadConfig(facts.profileId, transaction)) };
    }

    private async windowContext(
        kind: StrengthWindowKind,
        target: MetricTarget,
        transaction?: unknown,
    ): Promise<{ facts: StrengthWindowFacts; config: Readonly<Record<string, unknown>> } | null> {
        const separator = target.scope.id.indexOf(":");
        if (separator <= 0) return null;
        const profileId = target.scope.id.slice(0, separator);
        const anchor = target.scope.id.slice(separator + 1);
        const bounds = strengthWindowBounds(kind, anchor);
        const sessions = await this.reader.loadWindowFacts(profileId, bounds.start, bounds.end, transaction);
        if (sessions.length === 0) return null;
        const facts: StrengthWindowFacts = { profileId, scope: target.scope, period: target.period, sessions };
        return { facts, config: configRecord(await this.reader.loadConfig(profileId, transaction)) };
    }
}

function windowKindOf(scopeType: string): StrengthWindowKind | null {
    switch (scopeType) {
        case "profile-day":
            return "day";
        case "profile-week":
            return "week";
        case "profile-rolling-7":
            return "rolling-7";
        case "profile-rolling-28":
            return "rolling-28";
        default:
            return null;
    }
}

/** The config record the framework hashes into the fingerprint — identical shape on both compute paths. */
function configRecord(config: StrengthMetricConfig): Readonly<Record<string, unknown>> {
    return {
        rpeThreshold: config.rpeThreshold,
        rirThreshold: config.rirThreshold,
        repMin: config.repMin,
        repCutoff: config.repCutoff,
        calculatorVersion: config.calculatorVersion,
    };
}
