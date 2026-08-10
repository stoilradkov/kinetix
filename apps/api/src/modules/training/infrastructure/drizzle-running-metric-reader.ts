import { Inject, Injectable } from "@nestjs/common";
import { and, between, eq, inArray, isNull } from "drizzle-orm";

import { sessionActivities, trainingProfiles, trainingSessions, zoneRanges, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    RUNNING_METRIC_READER,
    TRAINING_SESSION_REPOSITORY,
    type MetricContextReader,
    type RunningMetricReader,
    type TrainingSessionRepository,
} from "#src/modules/training/application/index";
import { entityId } from "#src/platform/domain/index";

import {
    RUNNING_METRIC_DEFAULTS_V1,
    strengthWindowBounds,
    type MetricTarget,
    type RunningActivityFacts,
    type RunningMetricConfig,
    type RunningSessionFacts,
    type RunningWindowFacts,
    type RunningWindowSessionFacts,
    type SessionActivityState,
    type StrengthWindowKind,
} from "#src/modules/training/domain/index";

/**
 * Bounded read adapter that assembles the exact running facts the running calculators score (issue #46, A4;
 * design §16.6). It composes the training-session repository (the full hydrated running summary/structured
 * state, session profile/date/version) with direct reads of the training-profile calculator version and the
 * zone-range positions that weight Edwards load. Only completed, non-archived sessions feed analytics; the
 * per-zone-time 1-based zone number is resolved from the referenced range's position. Drizzle rows never escape.
 */
@Injectable()
export class DrizzleRunningMetricReader implements RunningMetricReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly sessions: Pick<TrainingSessionRepository, "readSession">,
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

    async loadSessionFacts(sessionId: string, transaction?: unknown): Promise<RunningSessionFacts | null> {
        const resource = await this.sessions.readSession(entityId(sessionId), transaction);
        if (resource === null || resource.status !== "completed" || resource.archivedAt !== null) return null;
        const activities = await this.activityFacts(resource.activities, transaction);
        if (activities.length === 0) return null; // not a running session — nothing to project
        return {
            sessionId: resource.id,
            profileId: resource.profileId,
            sessionVersion: resource.version,
            localDate: resource.localDate,
            activities,
        };
    }

    async loadConfig(profileId: string, transaction?: unknown): Promise<RunningMetricConfig> {
        const [row] = await this.executor(transaction)
            .select({ calculatorVersion: trainingProfiles.calculatorVersion })
            .from(trainingProfiles)
            .where(eq(trainingProfiles.profileId, profileId))
            .limit(1);
        return { calculatorVersion: row?.calculatorVersion ?? RUNNING_METRIC_DEFAULTS_V1.calculatorVersion };
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
            .innerJoin(sessionActivities, eq(sessionActivities.sessionId, trainingSessions.id))
            .where(runningSessionsInRange(profileId, from, to));
        return rows.map(row => row.localDate);
    }

    async loadWindowFacts(
        profileId: string,
        from: string,
        to: string,
        transaction?: unknown,
    ): Promise<readonly RunningWindowSessionFacts[]> {
        const rows = await this.executor(transaction)
            .selectDistinct({ id: trainingSessions.id })
            .from(trainingSessions)
            .innerJoin(sessionActivities, eq(sessionActivities.sessionId, trainingSessions.id))
            .where(runningSessionsInRange(profileId, from, to));

        const sessions: RunningWindowSessionFacts[] = [];
        for (const { id } of rows) {
            const resource = await this.sessions.readSession(entityId(id), transaction);
            if (resource === null || resource.status !== "completed" || resource.archivedAt !== null) continue;
            const activities = await this.activityFacts(resource.activities, transaction);
            if (activities.length === 0) continue;
            sessions.push({
                sessionId: resource.id,
                sessionVersion: resource.version,
                localDate: resource.localDate,
                activities,
            });
        }
        return sessions;
    }

    /** Build per-running-activity facts, resolving each zone time's 1-based zone number from its range. */
    private async activityFacts(
        activities: readonly SessionActivityState[],
        transaction?: unknown,
    ): Promise<RunningActivityFacts[]> {
        const rangeIds = new Set<string>();
        for (const activity of activities)
            if (activity.running !== null)
                for (const zone of activity.running.zoneTimes)
                    if (zone.zoneRangeId !== null) rangeIds.add(zone.zoneRangeId);
        const positions = await this.zoneRangePositions([...rangeIds], transaction);

        const facts: RunningActivityFacts[] = [];
        for (const activity of activities) {
            if (activity.running === null) continue;
            const zoneNumbers: Record<string, number> = {};
            for (const zone of activity.running.zoneTimes) {
                if (zone.zoneRangeId === null) continue;
                const position = positions.get(zone.zoneRangeId);
                if (position !== undefined) zoneNumbers[zone.id] = position + 1; // zone 1 = lowest range
            }
            facts.push({
                activityId: activity.id,
                running: activity.running,
                activityRpe: activity.rpe,
                durationSeconds: activity.durationSeconds,
                zoneNumbers,
            });
        }
        return facts;
    }

    /** Resolve `zoneRangeId → position` for the given range ids (a range's position is its zone index). */
    private async zoneRangePositions(rangeIds: readonly string[], transaction?: unknown): Promise<Map<string, number>> {
        if (rangeIds.length === 0) return new Map();
        const rows = await this.executor(transaction)
            .select({ id: zoneRanges.id, position: zoneRanges.position })
            .from(zoneRanges)
            .where(inArray(zoneRanges.id, [...rangeIds]));
        return new Map(rows.map(row => [row.id, row.position]));
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

/** Completed, non-archived running sessions for a profile with a local date in the inclusive `[from, to]`. */
function runningSessionsInRange(profileId: string, from: string, to: string) {
    return and(
        eq(trainingSessions.profileId, profileId),
        eq(trainingSessions.status, "completed"),
        isNull(trainingSessions.archivedAt),
        eq(sessionActivities.type, "running"),
        between(trainingSessions.localDate, from, to),
    );
}

/**
 * The {@link MetricContextReader} the A1 rebuild framework uses to recompute a single stored *running* metric
 * (issue #46, A4). Given a target it dispatches on the scope type — a `session` scope loads the session's
 * running facts, a `profile-*` window scope loads the window's running sessions — and returns them with the
 * profile's versioned config. Discovery of new metrics is the projection use case's job; this reader only
 * reloads facts for an already-known target, returning `null` when the source is gone so the recompute retires
 * the row. The facts and config it returns match the projection path exactly, so both produce the same
 * fingerprint. The composite context reader routes `running.*` calculator keys here.
 */
@Injectable()
export class DrizzleRunningMetricContextReader implements MetricContextReader {
    constructor(@Inject(RUNNING_METRIC_READER) private readonly reader: RunningMetricReader) {}

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
    ): Promise<{ facts: RunningSessionFacts; config: Readonly<Record<string, unknown>> } | null> {
        const facts = await this.reader.loadSessionFacts(target.scope.id, transaction);
        if (facts === null) return null;
        return { facts, config: configRecord(await this.reader.loadConfig(facts.profileId, transaction)) };
    }

    private async windowContext(
        kind: StrengthWindowKind,
        target: MetricTarget,
        transaction?: unknown,
    ): Promise<{ facts: RunningWindowFacts; config: Readonly<Record<string, unknown>> } | null> {
        const separator = target.scope.id.indexOf(":");
        if (separator <= 0) return null;
        const profileId = target.scope.id.slice(0, separator);
        const anchor = target.scope.id.slice(separator + 1);
        const bounds = strengthWindowBounds(kind, anchor);
        const sessions = await this.reader.loadWindowFacts(profileId, bounds.start, bounds.end, transaction);
        if (sessions.length === 0) return null;
        const facts: RunningWindowFacts = { profileId, scope: target.scope, period: target.period, sessions };
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
function configRecord(config: RunningMetricConfig): Readonly<Record<string, unknown>> {
    return { calculatorVersion: config.calculatorVersion };
}
