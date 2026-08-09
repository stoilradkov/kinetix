import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, isNull, lt, or } from "drizzle-orm";

import { sessionMappings, trainingSessions, zoneDefinitions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { MetricInvalidationReader } from "#src/modules/training/application/index";

/**
 * Resolves the cross-references invalidation fan-out needs but an event payload does not carry (issue #43,
 * A1; design §16.3): the profile/date/plan of a session, the actual sessions a plan or context date affects,
 * and the sessions inside a zone definition's effective interval. Read-only bounded queries; rows never
 * escape the adapter.
 */
@Injectable()
export class DrizzleMetricInvalidationReader implements MetricInvalidationReader {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async describeSession(
        sessionId: string,
        transaction?: unknown,
    ): Promise<{ profileId: string; localDate: string | null; plannedSessionIds: readonly string[] } | null> {
        const executor = this.executor(transaction);
        const [session] = await executor
            .select({ profileId: trainingSessions.profileId, localDate: trainingSessions.localDate })
            .from(trainingSessions)
            .where(eq(trainingSessions.id, sessionId))
            .limit(1);
        if (session === undefined) return null;
        const mappings = await executor
            .select({ plannedSessionId: sessionMappings.plannedSessionId })
            .from(sessionMappings)
            .where(eq(sessionMappings.sessionId, sessionId));
        const plannedSessionIds = mappings.map(row => row.plannedSessionId).filter((id): id is string => id !== null);
        return { profileId: session.profileId, localDate: session.localDate, plannedSessionIds };
    }

    async sessionsForPlan(plannedSessionId: string, transaction?: unknown): Promise<readonly string[]> {
        const executor = this.executor(transaction);
        const rows = await executor
            .selectDistinct({ sessionId: sessionMappings.sessionId })
            .from(sessionMappings)
            .where(eq(sessionMappings.plannedSessionId, plannedSessionId));
        return rows.map(row => row.sessionId);
    }

    async sessionsForContextDate(profileId: string, transaction?: unknown): Promise<readonly string[]> {
        // A manual context change (e.g. bodyweight) can feed any of the profile's sessions; a calculator that
        // narrows by the exact date lands with the context-aware metrics in the analytics slice (A2+).
        const executor = this.executor(transaction);
        const rows = await executor
            .select({ id: trainingSessions.id })
            .from(trainingSessions)
            .where(eq(trainingSessions.profileId, profileId));
        return rows.map(row => row.id);
    }

    async sessionsInZoneInterval(zoneId: string, transaction?: unknown): Promise<readonly string[]> {
        const executor = this.executor(transaction);
        const [zone] = await executor
            .select({
                profileId: zoneDefinitions.profileId,
                effectiveFrom: zoneDefinitions.effectiveFrom,
                effectiveTo: zoneDefinitions.effectiveTo,
            })
            .from(zoneDefinitions)
            .where(eq(zoneDefinitions.id, zoneId))
            .limit(1);
        if (zone === undefined) return [];
        const rows = await executor
            .select({ id: trainingSessions.id })
            .from(trainingSessions)
            .where(
                and(
                    eq(trainingSessions.profileId, zone.profileId),
                    gte(trainingSessions.startedAt, zone.effectiveFrom),
                    zone.effectiveTo === null
                        ? undefined
                        : or(isNull(trainingSessions.startedAt), lt(trainingSessions.startedAt, zone.effectiveTo)),
                ),
            );
        return rows.map(row => row.id);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}
