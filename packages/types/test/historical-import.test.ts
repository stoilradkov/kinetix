import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
    bulkProgramInputSchema,
    historicalCompletedSessionSchema,
    historicalExerciseReferenceSchema,
    historicalImportDryRunResponseSchema,
    historicalImportEnvelopeSchema,
} from "#src/index";

// ---------------------------------------------------------------------------------------------
// Canonical fixtures (design §14; issue #55 test cases)
// ---------------------------------------------------------------------------------------------

const EXERCISE_ID = "0198a4db-d8da-7000-8000-0000000000a1";
const EQUIPMENT_ID = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT_ID = "0198a4db-d8da-7000-8000-0000000000c1";

/** A minimal already-normalized program, reusing the shipped bulk-program contract. */
function programInput(externalId = "prog-1") {
    return {
        externalId,
        name: "Spring Strength",
        scheduleMode: "dated" as const,
        startDate: "2026-09-01",
        blocks: [{ externalId: `${externalId}-blk-1`, type: "mesocycle" as const, position: 0, relativeStartWeek: 0 }],
        sessions: [
            {
                externalId: `${externalId}-sess-1`,
                title: "Squat Day",
                sequence: 0,
                relativeWeek: 0,
                relativeDay: 0,
                blockExternalIds: [`${externalId}-blk-1`],
                prescription: {
                    activities: [
                        {
                            type: "strength" as const,
                            externalId: `${externalId}-pact-1`,
                            position: 0,
                            exercises: [
                                {
                                    externalId: `${externalId}-pex-1`,
                                    ref: "ex-1",
                                    reference: { by: "id" as const, exerciseId: EXERCISE_ID },
                                    position: 0,
                                    sets: [
                                        {
                                            externalId: `${externalId}-pset-1`,
                                            ref: "set-1",
                                            position: 0,
                                            setType: "working" as const,
                                            targets: { repsMin: 5, repsMax: 5, loadMin: { value: 100, unit: "kg" } },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        ],
    };
}

/** A completed strength session with one occurrence and one performed set. */
function completedSession(externalId = "sess-hist-1", overrides: Record<string, unknown> = {}) {
    return {
        externalId,
        localDate: "2025-03-14",
        timeZone: "Europe/London",
        startedAt: "2025-03-14T09:00:00.000Z",
        endedAt: "2025-03-14T10:15:00.000Z",
        durationMinutes: 75,
        tags: ["squat"],
        activities: [
            {
                type: "strength" as const,
                externalId: `${externalId}-act-1`,
                position: 0,
                strength: {
                    occurrences: [
                        {
                            externalId: `${externalId}-occ-1`,
                            reference: { by: "id" as const, exerciseId: EXERCISE_ID },
                            position: 0,
                            performedSets: [
                                {
                                    externalId: `${externalId}-pset-1`,
                                    position: 0,
                                    setType: "working" as const,
                                    status: "completed" as const,
                                    measurements: {
                                        reps: 5,
                                        externalLoad: { value: 100, unit: "kg" },
                                        rpe: 8,
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
        ...overrides,
    };
}

function envelope(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1 as const,
        source: {
            namespace: "coach-archive",
            generatedBy: "agent@1.2",
            payloadId: "archive-2025-03",
            checksum: "a".repeat(64),
        },
        mode: "create" as const,
        programs: [programInput()],
        completedSessions: [completedSession()],
        ...overrides,
    };
}

describe("historicalImportEnvelopeSchema — acceptance criteria", () => {
    it("carries multiple normalized programs and completed sessions in one payload", () => {
        const parsed = historicalImportEnvelopeSchema.parse(
            envelope({
                programs: [programInput("prog-1"), programInput("prog-2")],
                completedSessions: [completedSession("sess-1"), completedSession("sess-2")],
            }),
        );
        expect(parsed.programs).toHaveLength(2);
        expect(parsed.completedSessions).toHaveLength(2);
        expect(parsed.source.payloadId).toBe("archive-2025-03");
    });

    it("keeps two completed sessions distinct on the same date and timestamp", () => {
        const sameDay = {
            localDate: "2025-03-14",
            startedAt: "2025-03-14T09:00:00.000Z",
        };
        const parsed = historicalImportEnvelopeSchema.parse(
            envelope({
                programs: undefined,
                completedSessions: [completedSession("morning", sameDay), completedSession("evening", sameDay)],
            }),
        );
        expect(parsed.completedSessions?.map(session => session.externalId)).toEqual(["morning", "evening"]);
    });

    it("accepts explicit planned/actual program mappings by external id", () => {
        const parsed = historicalImportEnvelopeSchema.parse(
            envelope({
                completedSessions: [
                    completedSession("sess-mapped", {
                        programMapping: {
                            plannedLink: { programExternalId: "prog-1", plannedSessionExternalId: "prog-1-sess-1" },
                            activities: [
                                {
                                    prescribedActivityExternalId: "prog-1-pact-1",
                                    actualActivityRef: "sess-mapped-act-1",
                                    relation: "matched",
                                },
                            ],
                            sets: [
                                {
                                    prescribedSetExternalId: null,
                                    performedSetRef: "sess-mapped-pset-1",
                                    relation: "added",
                                },
                            ],
                        },
                    }),
                ],
            }),
        );
        expect(parsed.completedSessions?.[0]?.programMapping?.plannedLink?.plannedSessionExternalId).toBe(
            "prog-1-sess-1",
        );
    });

    it("accepts an explicit complete new-exercise definition on an occurrence", () => {
        const withProposed = completedSession("sess-proposed");
        withProposed.activities[0]!.strength.occurrences[0]! = {
            ...withProposed.activities[0]!.strength.occurrences[0]!,
            reference: { by: "slug", slug: "single-leg-hip-thrust" },
            proposed: {
                name: "Single-leg Hip Thrust",
                equipmentTypeId: EQUIPMENT_ID,
                movementPatternId: MOVEMENT_ID,
                classification: "compound",
                laterality: "unilateral",
                bodyPosition: "supine",
                repetitionSemantics: "per_side",
                loadModel: "external_only",
                supportedMeasurements: ["repetitions", "external_load"],
            },
        } as (typeof withProposed.activities)[0]["strength"]["occurrences"][0];
        expect(historicalImportEnvelopeSchema.safeParse(envelope({ completedSessions: [withProposed] })).success).toBe(
            true,
        );
    });

    it("preserves omitted / explicit-null / known-zero measurement semantics", () => {
        const session = completedSession("sess-null");
        session.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements = {
            reps: 0, // known zero
            externalLoad: null, // explicitly cleared
            // bodyweight omitted → no value
            rpe: 8,
        };
        const parsed = historicalCompletedSessionSchema.parse(session);
        const measurements = parsed.activities[0]!;
        const set =
            measurements.type === "strength" ? measurements.strength.occurrences[0]!.performedSets[0]! : undefined;
        expect(set?.measurements?.reps).toBe(0);
        expect(set?.measurements?.externalLoad).toBeNull();
        expect(set?.measurements && "bodyweight" in set.measurements).toBe(false);
    });
});

describe("historicalExerciseReferenceSchema — canonical only", () => {
    it("accepts id, slug, and provider external-id references", () => {
        expect(historicalExerciseReferenceSchema.safeParse({ by: "id", exerciseId: EXERCISE_ID }).success).toBe(true);
        expect(historicalExerciseReferenceSchema.safeParse({ by: "slug", slug: "back-squat" }).success).toBe(true);
        expect(
            historicalExerciseReferenceSchema.safeParse({ by: "externalId", provider: "strong", externalId: "sq-1" })
                .success,
        ).toBe(true);
    });

    it("rejects a raw exercise label / fuzzy alias reference", () => {
        expect(historicalExerciseReferenceSchema.safeParse({ by: "alias", alias: "Back Squat" }).success).toBe(false);
        expect(historicalExerciseReferenceSchema.safeParse({ by: "name", name: "Back Squat" }).success).toBe(false);
        expect(historicalExerciseReferenceSchema.safeParse("Back Squat").success).toBe(false);
    });
});

describe("historicalImportEnvelopeSchema — rejections", () => {
    it("rejects an unsupported schema version", () => {
        expect(historicalImportEnvelopeSchema.safeParse(envelope({ schemaVersion: 2 })).success).toBe(false);
    });

    it("rejects an empty payload with neither programs nor sessions", () => {
        expect(
            historicalImportEnvelopeSchema.safeParse(envelope({ programs: undefined, completedSessions: [] })).success,
        ).toBe(false);
    });

    it("rejects a non-hex or wrong-length checksum", () => {
        expect(
            historicalImportEnvelopeSchema.safeParse(
                envelope({ source: { namespace: "n", payloadId: "p", checksum: "not-a-real-digest" } }),
            ).success,
        ).toBe(false);
    });

    it("rejects an ambiguous / non-scalar RPE", () => {
        const rangeRpe = completedSession("sess-rpe");
        (
            rangeRpe.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements as Record<string, unknown>
        ).rpe = { min: 7, max: 9 };
        expect(historicalCompletedSessionSchema.safeParse(rangeRpe).success).toBe(false);

        const wordRpe = completedSession("sess-rpe-2");
        (
            wordRpe.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements as Record<string, unknown>
        ).rpe = "hard";
        expect(historicalCompletedSessionSchema.safeParse(wordRpe).success).toBe(false);

        const fractionalRpe = completedSession("sess-rpe-3");
        (
            fractionalRpe.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements as Record<
                string,
                unknown
            >
        ).rpe = 7.25;
        expect(historicalCompletedSessionSchema.safeParse(fractionalRpe).success).toBe(false);
    });

    it("rejects a missing-load placeholder instead of a canonical mass", () => {
        const placeholder = completedSession("sess-load");
        (
            placeholder.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements as Record<
                string,
                unknown
            >
        ).externalLoad = "n/a";
        expect(historicalCompletedSessionSchema.safeParse(placeholder).success).toBe(false);

        const negative = completedSession("sess-load-2");
        (
            negative.activities[0]!.strength.occurrences[0]!.performedSets[0]!.measurements as Record<string, unknown>
        ).externalLoad = { value: -5, unit: "kg" };
        expect(historicalCompletedSessionSchema.safeParse(negative).success).toBe(false);
    });

    it("rejects invalid dates, date ranges, and placeholders", () => {
        expect(
            historicalCompletedSessionSchema.safeParse(completedSession("s", { localDate: "2021-2022" })).success,
        ).toBe(false);
        expect(historicalCompletedSessionSchema.safeParse(completedSession("s", { localDate: "TBD" })).success).toBe(
            false,
        );
        expect(
            historicalCompletedSessionSchema.safeParse(completedSession("s", { localDate: "2021-02-30" })).success,
        ).toBe(false);
        expect(historicalCompletedSessionSchema.safeParse(completedSession("s", { startedAt: "2021" })).success).toBe(
            false,
        );
    });

    it("rejects source-specific spreadsheet fields on any node", () => {
        expect(historicalCompletedSessionSchema.safeParse(completedSession("s", { sourceCell: "B12" })).success).toBe(
            false,
        );
        const coordinatedSet = completedSession("s2");
        (coordinatedSet.activities[0]!.strength.occurrences[0]!.performedSets[0]! as Record<string, unknown>).sheetRow =
            42;
        expect(historicalCompletedSessionSchema.safeParse(coordinatedSet).success).toBe(false);
    });
});

describe("historicalImportEnvelopeSchema — wire publication & compatibility", () => {
    it("publishes a JSON Schema without unrepresentable-type errors", () => {
        const jsonSchema = z.toJSONSchema(historicalImportEnvelopeSchema, { unrepresentable: "any" });
        expect(jsonSchema).toMatchObject({ type: "object" });
        expect(JSON.stringify(jsonSchema)).toContain("completedSessions");
    });

    it("round-trips: a parsed payload re-parses to the identical value", () => {
        const once = historicalImportEnvelopeSchema.parse(envelope());
        const twice = historicalImportEnvelopeSchema.parse(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
    });

    it("stays backward compatible: an existing bulk-program input is a valid program entry", () => {
        // The same object accepted by the shipped single-program contract is accepted here as one program.
        expect(bulkProgramInputSchema.safeParse(programInput()).success).toBe(true);
        expect(historicalImportEnvelopeSchema.safeParse(envelope({ completedSessions: undefined })).success).toBe(true);
    });
});

describe("historicalImportDryRunResponseSchema — HI4 preview contract", () => {
    function dryRunResponse(overrides: Record<string, unknown> = {}) {
        return {
            dryRunId: "0198a4db-d8da-7000-8000-0000000000f0",
            approvalToken: "token-abc",
            referenceHash: "b".repeat(64),
            schemaVersion: 1,
            mode: "create",
            source: { namespace: "coach-app", generatedBy: null },
            state: "ready",
            createdAt: "2026-08-01T10:00:00.000Z",
            expiresAt: "2026-08-01T11:00:00.000Z",
            programs: [],
            completedSessions: [],
            storagePlan: {
                namespace: "coach-app",
                mode: "create",
                entries: [],
                counts: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
                conflicts: [],
                hasConflicts: false,
            },
            summary: {
                programs: 0,
                completedSessions: 0,
                entities: 0,
                operations: { create: 0, update: 0, "skip-identical": 0, conflict: 0 },
                entityTypeCounts: [],
            },
            warnings: [],
            errors: [],
            mappings: [],
            proposedExercises: [],
            affectedVersions: [],
            ...overrides,
        };
    }

    it("accepts a minimal ready preview and round-trips", () => {
        const once = historicalImportDryRunResponseSchema.parse(dryRunResponse());
        const twice = historicalImportDryRunResponseSchema.parse(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
    });

    it("accepts a storage plan entry carrying a conflict outcome", () => {
        const response = dryRunResponse({
            state: "needs_mapping",
            storagePlan: {
                namespace: "coach-app",
                mode: "create",
                entries: [
                    {
                        path: ["completedSessions", 0],
                        entityType: "training-session",
                        externalId: "ts-1",
                        operation: "conflict",
                        currentEntityId: "0198a4db-d8da-7000-8000-0000000000f1",
                        currentVersion: 2,
                        conflictCode: "EXTERNAL_ID_EXISTS",
                    },
                ],
                counts: { create: 0, update: 0, "skip-identical": 0, conflict: 1 },
                conflicts: [
                    {
                        path: ["completedSessions", 0],
                        entityType: "training-session",
                        externalId: "ts-1",
                        operation: "conflict",
                        currentEntityId: "0198a4db-d8da-7000-8000-0000000000f1",
                        currentVersion: 2,
                        conflictCode: "EXTERNAL_ID_EXISTS",
                    },
                ],
                hasConflicts: true,
            },
        });
        expect(historicalImportDryRunResponseSchema.safeParse(response).success).toBe(true);
    });

    it("rejects an unknown top-level field", () => {
        expect(historicalImportDryRunResponseSchema.safeParse(dryRunResponse({ smuggled: true })).success).toBe(false);
    });
});
