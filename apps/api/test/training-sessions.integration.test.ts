import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { and, eq, inArray } from "drizzle-orm";

import { createDatabase, entityRevisions, painRecords, sessionActivities, trainingSessions } from "@kinetix/db";

import type { DatabaseService } from "#src/database/database.service";
import {
    TRAINING_SESSION_ENTITY_TYPE,
    TrainingSessionCommands,
    trainingSessionSerializer,
} from "#src/modules/training/application/index";
import { DrizzleTrainingSessionRepository } from "#src/modules/training/infrastructure/drizzle-training-session-repository";
import { RevisionMutationService, type CommandContext, type UnitOfWork } from "#src/platform/application/index";
import { DrizzleOutboxStore } from "#src/platform/infrastructure/drizzle-outbox-store";
import { DrizzleRevisionStore } from "#src/platform/infrastructure/drizzle-revision-store";

const testDatabaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
const profileId = randomUUID();
const now = new Date("2026-08-02T09:00:00.000Z");
const later = new Date("2026-08-02T10:30:00.000Z");
const metadata: CommandContext = { correlationId: "session-int", source: "user" };

describe.runIf(testDatabaseUrl)("training session PostgreSQL persistence", () => {
    const connection = createDatabase(testDatabaseUrl ?? "");
    const db = connection as unknown as DatabaseService;
    const repository = new DrizzleTrainingSessionRepository(db);
    const revisions = new DrizzleRevisionStore(db);
    const outbox = new DrizzleOutboxStore(db);
    const unitOfWork: UnitOfWork = { execute: work => connection.db.transaction(work as never) as never };
    const clock = { now: () => now };
    const profileReader = {
        getActiveProfile: async () => ({
            id: profileId,
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", height: "cm" } as never,
            birthDate: null,
            sex: null,
            heightMeters: null,
            version: 1,
        }),
    };
    const commands = new TrainingSessionCommands({
        unitOfWork,
        repository,
        mutations: new RevisionMutationService(
            unitOfWork,
            repository,
            revisions,
            trainingSessionSerializer,
            outbox,
            clock,
        ),
        profileReader,
        clock,
        generateId: randomUUID,
    });

    afterAll(async () => {
        try {
            const rows = await connection.db
                .select({ id: trainingSessions.id })
                .from(trainingSessions)
                .where(eq(trainingSessions.profileId, profileId));
            const ids = rows.map(row => row.id);
            if (ids.length > 0) {
                await connection.db.delete(painRecords).where(inArray(painRecords.sessionId, ids));
                await connection.db.delete(sessionActivities).where(inArray(sessionActivities.sessionId, ids));
                await connection.db.delete(entityRevisions).where(inArray(entityRevisions.entityId, ids));
            }
            await connection.db.delete(trainingSessions).where(eq(trainingSessions.profileId, profileId));
        } catch {
            // Best effort cleanup.
        }
        await connection.client.end({ timeout: 5 });
    });

    it("round-trips a session tree through start, edit, and complete", async () => {
        const created = await commands.create(
            {
                title: "Upper A",
                readiness: { energy: 4, motivation: 5 },
                tags: ["Push", "push"],
            },
            metadata,
        );
        expect(created).toMatchObject({ status: "draft", version: 1, tags: ["Push"] });

        const activityId = randomUUID();
        const painId = randomUUID();
        const edited = await commands.update(
            created.id,
            created.version,
            {
                durationMinutes: 60,
                activities: [{ id: activityId, type: "strength", position: 0, rpe: 8 }],
                painRecords: [
                    {
                        id: painId,
                        activityId,
                        bodyArea: "Lower back",
                        side: "left",
                        severity: 5,
                        onsetDuringSession: true,
                        stoppedActivity: false,
                    },
                ],
            },
            metadata,
        );
        expect(edited.version).toBe(2);

        const started = await commands.start(created.id, edited.version, metadata);
        expect(started.startedAt).toBe(now.toISOString());
        const completed = await commands.complete(
            created.id,
            started.version,
            { endedAt: later.toISOString() },
            metadata,
        );
        expect(completed).toMatchObject({ status: "completed", version: 4 });

        const reloaded = await repository.readSession(created.id as never);
        expect(reloaded).not.toBeNull();
        expect(reloaded!.durationMinutes).toBe(60);
        expect(reloaded!.readiness.energy).toBe(4);
        expect(reloaded!.activities).toHaveLength(1);
        expect(reloaded!.painRecords[0]).toMatchObject({ activityId, bodyArea: "Lower back", severity: 5 });
        expect(reloaded!.endedAt).toBe(later.toISOString());

        // Every mutation appended a revision.
        const history = await connection.db
            .select({ version: entityRevisions.version })
            .from(entityRevisions)
            .where(
                and(
                    eq(entityRevisions.entityType, TRAINING_SESSION_ENTITY_TYPE),
                    eq(entityRevisions.entityId, created.id),
                ),
            );
        expect(history).toHaveLength(4);
    });

    it("removes deleted activities and nulls their pain links on edit", async () => {
        const activityId = randomUUID();
        const painId = randomUUID();
        const created = await commands.create(
            {
                activities: [{ id: activityId, type: "strength", position: 0 }],
                painRecords: [{ id: painId, activityId, bodyArea: "Knee", side: "right", severity: 3 }],
            },
            metadata,
        );
        const edited = await commands.update(created.id, created.version, { activities: [] }, metadata);
        expect(edited.activities).toHaveLength(0);
        const reloaded = await repository.readSession(created.id as never);
        expect(reloaded!.painRecords).toHaveLength(1);
        expect(reloaded!.painRecords[0]!.activityId).toBeNull();
        const remainingActivities = await connection.db
            .select()
            .from(sessionActivities)
            .where(eq(sessionActivities.sessionId, created.id));
        expect(remainingActivities).toHaveLength(0);
    });

    it("filters archived sessions out of the default list", async () => {
        const created = await commands.create({ title: "To archive" }, metadata);
        await commands.archive(created.id, created.version, metadata);
        const active = await repository.listSessions();
        const all = await repository.listSessions({ includeArchived: true });
        expect(active.some(session => session.id === created.id)).toBe(false);
        expect(all.some(session => session.id === created.id)).toBe(true);
    });

    it("enforces the unique activity-position constraint", async () => {
        const sessionId = randomUUID();
        await connection.db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "draft",
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
        });
        await connection.db
            .insert(sessionActivities)
            .values({ id: randomUUID(), sessionId, type: "strength", position: 0 });
        await expect(
            connection.db
                .insert(sessionActivities)
                .values({ id: randomUUID(), sessionId, type: "running", position: 0 }),
        ).rejects.toThrow();
    });

    it("rejects an out-of-range pain severity at the database", async () => {
        const sessionId = randomUUID();
        await connection.db.insert(trainingSessions).values({
            id: sessionId,
            profileId,
            status: "draft",
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
        });
        await expect(
            connection.db
                .insert(painRecords)
                .values({ id: randomUUID(), sessionId, bodyArea: "Knee", side: "left", severity: 11 }),
        ).rejects.toThrow();
    });
});
