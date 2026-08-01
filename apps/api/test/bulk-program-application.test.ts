import { describe, expect, it } from "vitest";

import {
    BulkCatalogResolver,
    DryRunBulkProgram,
    ExerciseNotFoundError,
    type BulkDryRunRepository,
    type ExerciseExternalIdResolver,
    type StoredBulkDryRun,
    type TrainingExerciseCatalogPort,
} from "#src/modules/training/application/index";
import { createExerciseSnapshot, ExerciseDefinition } from "#src/modules/training/domain/index";
import type { CommandContext, UnitOfWork } from "#src/platform/application/index";
import type { BulkProgramEnvelope } from "@kinetix/types";

const PROFILE = "0198a4db-d8da-7000-8000-0000000000d9";
const EQUIPMENT = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT = "0198a4db-d8da-7000-8000-0000000000c1";
const MUSCLE = "0198a4db-d8da-7000-8000-0000000000e1";
const SQUAT = "0198a4db-d8da-7000-8000-0000000000a1";
const now = new Date("2026-08-01T10:00:00.000Z");
const transaction = {};
const metadata: CommandContext = { correlationId: "req-1", source: "agent" };

function idFactory(): () => string {
    let index = 0;
    return () => {
        index += 1;
        return `0198a4db-d8da-7000-8000-${index.toString(16).padStart(12, "0")}`;
    };
}

function squatDefinition(id = SQUAT): ExerciseDefinition {
    return ExerciseDefinition.create(
        {
            id,
            slug: "back-squat",
            name: "Back Squat",
            ownership: "seeded",
            equipmentTypeId: EQUIPMENT,
            movementPatternId: MOVEMENT,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: MUSCLE, role: "primary" }],
        },
        now,
    );
}

function catalogItem(id: string, name: string, slug: string) {
    return {
        id,
        slug,
        name,
        aliases: [] as string[],
        status: "active" as const,
        ownership: "seeded" as const,
        equipment: {
            id: EQUIPMENT,
            slug: "barbell",
            name: "Barbell",
            position: 0,
            ownership: "seeded" as const,
            analyticsMappingStatus: "standard" as const,
        },
        movementPattern: {
            id: MOVEMENT,
            slug: "squat",
            name: "Squat",
            position: 0,
            ownership: "seeded" as const,
            analyticsMappingStatus: "standard" as const,
        },
        classification: "compound" as const,
        laterality: "bilateral" as const,
        bodyPosition: "standing",
        repetitionSemantics: "total" as const,
        loadModel: "external_only" as const,
        supportedMeasurements: ["repetitions", "external_load"] as const,
        muscles: [],
        tags: [],
        notes: null,
        version: 3,
        position: 0,
    };
}

/** A catalog fake whose alias/name lookups are configurable to exercise resolved/missing/ambiguous. */
function fakeCatalog(options: {
    byId?: Record<string, ReturnType<typeof catalogItem>>;
    byAlias?: Record<string, ReturnType<typeof catalogItem> | null>;
    search?: Record<string, ReturnType<typeof catalogItem>[]>;
}): TrainingExerciseCatalogPort {
    const snapshotFor = (id: string) => createExerciseSnapshot(squatDefinition(id), options.byId?.[id]?.version ?? 3);
    return {
        async getExercise(id) {
            const item = options.byId?.[id];
            if (!item) throw new ExerciseNotFoundError(id);
            return item;
        },
        async resolveCurrentExercise(id) {
            const item = options.byId?.[id];
            if (!item) throw new ExerciseNotFoundError(id);
            return { requestedExerciseId: id, resolvedExerciseId: id, redirected: false, exercise: item };
        },
        async listExercises(filter) {
            const items = options.search?.[(filter.search ?? "").toLowerCase()] ?? [];
            return { items, nextCursor: null };
        },
        async resolveAlias(alias) {
            return options.byAlias?.[alias.toLowerCase()] ?? null;
        },
        async currentSnapshot(id) {
            return snapshotFor(id);
        },
        async historicalSnapshot(id) {
            return snapshotFor(id);
        },
        async areInAnalyticsFamily() {
            return false;
        },
    };
}

const noExternalIds: ExerciseExternalIdResolver = { resolveByExternalId: async () => null };

function recordingRepository(): BulkDryRunRepository<typeof transaction> & { saved: StoredBulkDryRun[] } {
    const saved: StoredBulkDryRun[] = [];
    return {
        saved,
        async save(record) {
            saved.push(record);
        },
        async findById(id) {
            return saved.find(record => record.id === id) ?? null;
        },
    };
}

function useCase(resolver: BulkCatalogResolver, repository: BulkDryRunRepository<typeof transaction>) {
    const unitOfWork: UnitOfWork<typeof transaction> = { execute: work => work(transaction) };
    return new DryRunBulkProgram({
        unitOfWork,
        repository,
        resolver,
        profileReader: { requireActiveProfileId: async () => PROFILE },
        clock: { now: () => now },
        generateId: idFactory(),
    });
}

function envelope(overrides: Partial<BulkProgramEnvelope["program"]> = {}): BulkProgramEnvelope {
    return {
        schemaVersion: 1,
        source: { namespace: "coach-app" },
        mode: "create",
        program: {
            externalId: "prog-1",
            name: "Spring Strength",
            scheduleMode: "dated",
            startDate: "2026-09-07",
            blocks: [{ externalId: "meso", type: "mesocycle", position: 0, relativeStartWeek: 0 }],
            sessions: [
                {
                    externalId: "sess-1",
                    title: "Squat Day",
                    sequence: 0,
                    relativeWeek: 0,
                    relativeDay: 0,
                    blockExternalIds: ["meso"],
                    prescription: {
                        activities: [
                            {
                                type: "strength",
                                position: 0,
                                exercises: [
                                    {
                                        ref: "ex-1",
                                        reference: { by: "alias", alias: "Back Squat" },
                                        position: 0,
                                        sets: [
                                            {
                                                position: 0,
                                                setType: "working",
                                                targets: {
                                                    repsMin: 5,
                                                    repsMax: 5,
                                                    loadMin: { value: 100, unit: "kg" },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
            ...overrides,
        },
    };
}

describe("DryRunBulkProgram", () => {
    it("resolves aliases, normalizes units, expands schedule, and returns the normalized tree", async () => {
        const repository = recordingRepository();
        const resolver = new BulkCatalogResolver(
            fakeCatalog({
                byAlias: { "back squat": catalogItem(SQUAT, "Back Squat", "back-squat") },
                byId: { [SQUAT]: catalogItem(SQUAT, "Back Squat", "back-squat") },
            }),
            noExternalIds,
        );
        const result = await useCase(resolver, repository).execute(envelope(), metadata);

        expect(result.state).toBe("ready");
        expect(result.mappings).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
        const session = result.program.sessions[0]!;
        // dated schedule: startDate 2026-09-07 + relativeWeek 0/day 0 → the start date itself
        expect(session.localDate).toBe("2026-09-07");
        expect(session.prescription).not.toBeNull();
        const set = session.prescription!.activities[0]!.strength!.exercises[0]!.sets[0]!;
        expect(set.targets.loadKgMin).toBe("100");
        expect(result.affectedVersions).toEqual([{ entityType: "training.exercise", entityId: SQUAT, version: 3 }]);
        expect(result.referenceHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.generatedSessionCount).toBe(1);
    });

    it("persists exactly one dry-run artifact and never a program/prescription (no write ports injected)", async () => {
        const repository = recordingRepository();
        const resolver = new BulkCatalogResolver(
            fakeCatalog({
                byAlias: { "back squat": catalogItem(SQUAT, "Back Squat", "back-squat") },
                byId: { [SQUAT]: catalogItem(SQUAT, "Back Squat", "back-squat") },
            }),
            noExternalIds,
        );
        const result = await useCase(resolver, repository).execute(envelope(), metadata);
        expect(repository.saved).toHaveLength(1);
        expect(repository.saved[0]!.id).toBe(result.dryRunId);
        expect(repository.saved[0]!.approvalToken).toBe(result.approvalToken);
        expect(repository.saved[0]!.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it("requires mapping for a missing exercise and omits its prescription", async () => {
        const repository = recordingRepository();
        const resolver = new BulkCatalogResolver(fakeCatalog({ byAlias: {}, search: {} }), noExternalIds);
        const result = await useCase(resolver, repository).execute(envelope(), metadata);

        expect(result.state).toBe("needs_mapping");
        expect(result.mappings).toHaveLength(1);
        expect(result.mappings[0]!.status).toBe("missing");
        expect(result.program.sessions[0]!.prescription).toBeNull();
        expect(result.errors[0]!.code).toBe("CATALOG_MAPPING_REQUIRED");
    });

    it("flags an ambiguous alias with candidate suggestions", async () => {
        const repository = recordingRepository();
        const other = "0198a4db-d8da-7000-8000-0000000000a2";
        const resolver = new BulkCatalogResolver(
            fakeCatalog({
                byAlias: {},
                search: {
                    "back squat": [
                        catalogItem(SQUAT, "Back Squat", "back-squat"),
                        catalogItem(other, "Box Squat", "box-squat"),
                    ],
                },
            }),
            noExternalIds,
        );
        const result = await useCase(resolver, repository).execute(envelope(), metadata);
        expect(result.mappings[0]!.status).toBe("ambiguous");
        expect(result.mappings[0]!.candidates).toHaveLength(2);
    });

    it("proposes a custom exercise when createMissingExercises is set and previews its definition", async () => {
        const repository = recordingRepository();
        const resolver = new BulkCatalogResolver(fakeCatalog({ byAlias: {}, search: {} }), noExternalIds);
        const payload = envelope();
        payload.createMissingExercises = true;
        const activity = payload.program.sessions![0]!.prescription.activities[0] as {
            exercises: { proposed?: unknown }[];
        };
        activity.exercises[0]!.proposed = {
            name: "Zercher Squat",
            equipmentTypeId: EQUIPMENT,
            movementPatternId: MOVEMENT,
            classification: "compound",
            laterality: "bilateral",
            bodyPosition: "standing",
            repetitionSemantics: "total",
            loadModel: "external_only",
            supportedMeasurements: ["repetitions", "external_load"],
            muscles: [{ muscleGroupId: MUSCLE, role: "primary" }],
        };
        const result = await useCase(resolver, repository).execute(payload, metadata);
        expect(result.mappings).toHaveLength(0);
        expect(result.proposedExercises).toHaveLength(1);
        expect(result.proposedExercises[0]!.definition.name).toBe("Zercher Squat");
        expect(result.program.sessions[0]!.prescription).not.toBeNull();
    });

    it("produces a stable reference fingerprint that changes when a referenced version changes", async () => {
        const build = async (version: number) => {
            const repository = recordingRepository();
            const item = { ...catalogItem(SQUAT, "Back Squat", "back-squat"), version };
            const resolver = new BulkCatalogResolver(
                fakeCatalog({ byAlias: { "back squat": item }, byId: { [SQUAT]: item } }),
                noExternalIds,
            );
            return (await useCase(resolver, repository).execute(envelope(), metadata)).referenceHash;
        };
        const first = await build(3);
        const same = await build(3);
        const changed = await build(4);
        expect(first).toBe(same);
        expect(first).not.toBe(changed);
    });

    it("rejects an over-large payload before resolving", async () => {
        const repository = recordingRepository();
        const resolver = new BulkCatalogResolver(fakeCatalog({}), noExternalIds);
        const huge = envelope();
        huge.program.blocks = Array.from({ length: 1_000 }, (_, index) => ({
            externalId: `b${index}`,
            type: "microcycle" as const,
            position: index,
        }));
        await expect(useCase(resolver, repository).execute(huge, metadata)).rejects.toThrow(/limit/i);
        expect(repository.saved).toHaveLength(0);
    });
});
