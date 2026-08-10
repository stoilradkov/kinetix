import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { runningActivities, sessionActivities, trainingSessions, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import type { RunningRecordsReader } from "#src/modules/training/application/index";

import {
    RUNNING_RECORD_DEFAULT_TOLERANCE,
    type RunRecordInput,
    type RunningRecordsConfig,
} from "#src/modules/training/domain/index";

/**
 * Bounded read adapter that assembles a profile's run history for the running-record computation (issue #46,
 * A4; design §16.6, §16.8). One optimized join over `training_sessions × session_activities (running) ×
 * running_activities` returns the canonical summary facts each record scores — never the nested run tree.
 * Records reflect completed, non-archived runs only. Drizzle rows never escape here.
 */
@Injectable()
export class DrizzleRunningRecordsReader implements RunningRecordsReader {
    constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

    async describeSession(sessionId: string, transaction?: unknown): Promise<{ profileId: string } | null> {
        const [row] = await this.executor(transaction)
            .select({ profileId: trainingSessions.profileId })
            .from(trainingSessions)
            .where(eq(trainingSessions.id, sessionId))
            .limit(1);
        return row ?? null;
    }

    loadConfig(): Promise<RunningRecordsConfig> {
        // The comparability tolerance is a versioned domain constant, not a per-profile setting.
        return Promise.resolve({ standardToleranceFraction: RUNNING_RECORD_DEFAULT_TOLERANCE });
    }

    async loadRunHistory(profileId: string, transaction?: unknown): Promise<readonly RunRecordInput[]> {
        const rows = await this.executor(transaction)
            .select({
                sessionId: trainingSessions.id,
                sessionVersion: trainingSessions.version,
                localDate: trainingSessions.localDate,
                activityId: runningActivities.activityId,
                distanceM: runningActivities.distanceM,
                movingTimeMs: runningActivities.movingTimeMs,
                elapsedTimeMs: runningActivities.elapsedTimeMs,
                averagePowerW: runningActivities.averagePowerW,
                maxPowerW: runningActivities.maxPowerW,
            })
            .from(runningActivities)
            .innerJoin(sessionActivities, eq(runningActivities.activityId, sessionActivities.id))
            .innerJoin(trainingSessions, eq(sessionActivities.sessionId, trainingSessions.id))
            .where(
                and(
                    eq(trainingSessions.profileId, profileId),
                    eq(trainingSessions.status, "completed"),
                    isNull(trainingSessions.archivedAt),
                ),
            );
        return rows.map(toRunRecordInput);
    }

    private executor(transaction: unknown): Database {
        return (transaction ?? this.database.db) as Database;
    }
}

function toRunRecordInput(row: {
    sessionId: string;
    sessionVersion: number;
    localDate: string;
    activityId: string;
    distanceM: string | null;
    movingTimeMs: number | null;
    elapsedTimeMs: number | null;
    averagePowerW: string | null;
    maxPowerW: string | null;
}): RunRecordInput {
    return {
        sessionId: row.sessionId,
        sessionVersion: row.sessionVersion,
        localDate: row.localDate,
        activityId: row.activityId,
        distanceMetres: row.distanceM === null ? null : Number(row.distanceM),
        movingTimeMs: row.movingTimeMs,
        elapsedTimeMs: row.elapsedTimeMs,
        averagePowerW: row.averagePowerW === null ? null : Number(row.averagePowerW),
        maxPowerW: row.maxPowerW === null ? null : Number(row.maxPowerW),
    };
}
