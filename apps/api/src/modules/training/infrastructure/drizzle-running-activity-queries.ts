import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq, isNull } from "drizzle-orm";

import { runningActivities, sessionActivities, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { RunListFilter, RunListItem, RunningActivityQueries } from "#src/modules/training/application/index";
import type { TrainingSessionStatus } from "#src/modules/training/domain/index";

/**
 * Bounded run-list projection (design §18.3 query separation). One optimized join over
 * `training_sessions × session_activities (running) × running_activities` returns scalar metadata plus
 * canonical distance/moving time per run — never the nested run tree — so `kin run list` and the web
 * `/training/runs` page stay light. This is a read-only query service and never becomes a write path.
 */
@Injectable()
export class DrizzleRunningActivityQueries implements RunningActivityQueries {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async listRuns(filter?: RunListFilter, transaction?: unknown): Promise<readonly RunListItem[]> {
        const executor = (transaction ?? this.database.db) as Database;
        const rows = await executor
            .select({
                sessionId: trainingSessions.id,
                activityId: runningActivities.activityId,
                version: trainingSessions.version,
                localDate: trainingSessions.localDate,
                status: trainingSessions.status,
                title: trainingSessions.title,
                archivedAt: trainingSessions.archivedAt,
                distanceM: runningActivities.distanceM,
                movingTimeMs: runningActivities.movingTimeMs,
                runTags: runningActivities.runTags,
                position: sessionActivities.position,
            })
            .from(runningActivities)
            .innerJoin(sessionActivities, eq(runningActivities.activityId, sessionActivities.id))
            .innerJoin(trainingSessions, eq(sessionActivities.sessionId, trainingSessions.id))
            .where(filter?.includeArchived ? undefined : isNull(trainingSessions.archivedAt))
            .orderBy(desc(trainingSessions.localDate), asc(trainingSessions.id), asc(sessionActivities.position));
        return rows.map(toRunListItem);
    }
}

function toRunListItem(row: {
    sessionId: string;
    activityId: string;
    version: number;
    localDate: string;
    status: string;
    title: string | null;
    archivedAt: Date | null;
    distanceM: string | null;
    movingTimeMs: number | null;
    runTags: string[] | null;
}): RunListItem {
    return {
        sessionId: row.sessionId,
        activityId: row.activityId,
        version: row.version,
        localDate: row.localDate,
        status: row.status as TrainingSessionStatus,
        title: row.title,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        distanceMetres: row.distanceM,
        movingTimeMs: row.movingTimeMs === null ? null : String(row.movingTimeMs),
        runTags: row.runTags ?? [],
    };
}
