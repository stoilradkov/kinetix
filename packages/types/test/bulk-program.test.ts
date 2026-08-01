import { describe, expect, it } from "vitest";

import { bulkDryRunResponseSchema, bulkProgramEnvelopeSchema } from "#src/index";

const EQUIPMENT_ID = "0198a4db-d8da-7000-8000-0000000000b1";
const MOVEMENT_ID = "0198a4db-d8da-7000-8000-0000000000c1";

function envelope() {
    return {
        schemaVersion: 1 as const,
        source: { namespace: "coach-app", generatedBy: "agent@1.2" },
        mode: "create" as const,
        createMissingExercises: false,
        program: {
            externalId: "prog-1",
            name: "Spring Strength",
            scheduleMode: "dated" as const,
            startDate: "2026-09-01",
            blocks: [{ externalId: "blk-1", type: "mesocycle" as const, position: 0, relativeStartWeek: 0 }],
            sessions: [
                {
                    externalId: "sess-1",
                    title: "Squat Day",
                    sequence: 0,
                    relativeWeek: 0,
                    relativeDay: 0,
                    blockExternalIds: ["blk-1"],
                    prescription: {
                        activities: [
                            {
                                type: "strength" as const,
                                position: 0,
                                exercises: [
                                    {
                                        ref: "ex-1",
                                        reference: { by: "alias" as const, alias: "Back Squat" },
                                        position: 0,
                                        sets: [
                                            {
                                                ref: "set-1",
                                                position: 0,
                                                setType: "working" as const,
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
        },
    };
}

describe("bulkProgramEnvelopeSchema", () => {
    it("accepts a versioned envelope with source namespace and nested external ids", () => {
        const parsed = bulkProgramEnvelopeSchema.parse(envelope());
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.source.namespace).toBe("coach-app");
        expect(parsed.program.sessions?.[0]?.externalId).toBe("sess-1");
    });

    it("rejects an unsupported schema version", () => {
        const result = bulkProgramEnvelopeSchema.safeParse({ ...envelope(), schemaVersion: 2 });
        expect(result.success).toBe(false);
    });

    it("preserves the omitted-vs-null distinction for optional fields", () => {
        const withNull = envelope();
        withNull.program = { ...withNull.program, description: null } as typeof withNull.program;
        const parsed = bulkProgramEnvelopeSchema.parse(withNull);
        expect(parsed.program.description).toBeNull();
        // omitted stays undefined
        expect("focus" in parsed.program).toBe(false);
    });

    it("rejects an unknown key (strict)", () => {
        const result = bulkProgramEnvelopeSchema.safeParse({ ...envelope(), unexpected: true });
        expect(result.success).toBe(false);
    });

    it("accepts each exercise reference discriminant", () => {
        for (const reference of [
            { by: "id" as const, exerciseId: EQUIPMENT_ID },
            { by: "externalId" as const, provider: "hevy", externalId: "abc" },
            { by: "alias" as const, alias: "Bench Press" },
        ]) {
            const payload = envelope();
            payload.program.sessions![0]!.prescription.activities[0]!.exercises[0]!.reference = reference;
            expect(bulkProgramEnvelopeSchema.safeParse(payload).success).toBe(true);
        }
        void MOVEMENT_ID;
    });
});

describe("bulkDryRunResponseSchema", () => {
    it("round-trips a minimal ready response", () => {
        const response = {
            dryRunId: "0198a4db-d8da-7000-8000-0000000000d1",
            approvalToken: "tok",
            referenceHash: "a".repeat(64),
            schemaVersion: 1 as const,
            mode: "create" as const,
            source: { namespace: "coach-app", generatedBy: null },
            state: "ready" as const,
            createdAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2026-08-01T01:00:00.000Z",
            program: {
                id: "0198a4db-d8da-7000-8000-0000000000e1",
                externalId: "prog-1",
                profileId: "0198a4db-d8da-7000-8000-0000000000f1",
                name: "Spring Strength",
                description: null,
                scheduleMode: "dated" as const,
                startDate: "2026-09-01",
                endDate: null,
                focus: null,
                goalIds: [],
                blocks: [],
                sessions: [],
            },
            generatedSessionCount: 0,
            warnings: [],
            errors: [],
            mappings: [],
            proposedExercises: [],
            affectedVersions: [],
        };
        expect(() => bulkDryRunResponseSchema.parse(response)).not.toThrow();
    });
});
