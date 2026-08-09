import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { sessionMappings, type Database } from "@kinetix/db";

import { DatabaseService } from "#src/database/database.service";
import {
    SESSION_PRESCRIPTION_REPOSITORY,
    TRAINING_SESSION_REPOSITORY,
    type AdherenceInputReader,
    type AdherenceSessionInputs,
    type SessionPrescriptionRepository,
    type TrainingSessionRepository,
} from "#src/modules/training/application/index";
import { entityId } from "#src/platform/domain/index";

import type { SessionPrescriptionState } from "#src/modules/training/domain/index";

/**
 * Mapping-aware adherence read adapter (issue #37, AD1). Loads the bounded inputs one calculation needs:
 * the completed session (state, version, activities, and full mapping tree) via the training-session
 * repository plus every distinct resolved-execution prescription it links via one batched prescription
 * load. `findSessionIdsForPlan` performs the reverse lookup a planned-session change needs to invalidate
 * the actual sessions mapped to that plan. Drizzle rows never escape this boundary.
 */
@Injectable()
export class DrizzleAdherenceInputReader implements AdherenceInputReader {
    constructor(
        @Inject(DatabaseService) private readonly database: DatabaseService,
        @Inject(TRAINING_SESSION_REPOSITORY)
        private readonly sessions: Pick<TrainingSessionRepository, "readSession">,
        @Inject(SESSION_PRESCRIPTION_REPOSITORY)
        private readonly prescriptions: Pick<SessionPrescriptionRepository, "loadTrees">,
    ) {}

    async loadInputs(sessionId: string, transaction?: unknown): Promise<AdherenceSessionInputs | null> {
        const resource = await this.sessions.readSession(entityId(sessionId), transaction);
        if (resource === null) return null;

        const resolvedIds = [...new Set(resource.plannedLinks.map(link => link.resolvedPrescriptionId))];
        const trees = resolvedIds.length === 0 ? [] : await this.prescriptions.loadTrees(resolvedIds, transaction);
        const resolvedPrescriptions = new Map<string, SessionPrescriptionState>(trees.map(tree => [tree.id, tree]));

        return {
            sessionId: resource.id,
            profileId: resource.profileId,
            version: resource.version,
            plannedLinks: resource.plannedLinks,
            activities: resource.activities,
            mappings: {
                plannedLinks: resource.plannedLinks,
                activityMappings: resource.activityMappings,
                occurrenceMappings: resource.occurrenceMappings,
                setMappings: resource.setMappings,
                runStepMappings: resource.runStepMappings,
            },
            resolvedPrescriptions,
        };
    }

    async findSessionIdsForPlan(plannedSessionId: string, transaction?: unknown): Promise<readonly string[]> {
        const executor = (transaction ?? this.database.db) as Database;
        const rows = await executor
            .selectDistinct({ sessionId: sessionMappings.sessionId })
            .from(sessionMappings)
            .where(eq(sessionMappings.plannedSessionId, plannedSessionId));
        return rows.map(row => row.sessionId);
    }
}
