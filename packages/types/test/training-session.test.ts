import { describe, expect, it } from "vitest";

import {
    completeTrainingSessionRequestSchema,
    createTrainingSessionRequestSchema,
    painRecordRequestSchema,
    trainingSessionResponseSchema,
    updateTrainingSessionRequestSchema,
} from "#src/index";

const uuid = "0198a4db-d8da-7000-8000-000000007001";
const activityId = "0198a4db-d8da-7000-8000-0000000070a1";

describe("training session contracts", () => {
    it("accepts a create request with readiness and activity placeholders", () => {
        const parsed = createTrainingSessionRequestSchema.parse({
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
            tags: ["Push"],
            readiness: { energy: 4, motivation: 5 },
            activities: [{ id: activityId, type: "strength", position: 0 }],
        });
        expect(parsed.readiness?.energy).toBe(4);
        expect(parsed.activities?.[0]?.type).toBe("strength");
    });

    it("rejects a readiness value outside 1-5", () => {
        expect(createTrainingSessionRequestSchema.safeParse({ readiness: { energy: 6 } }).success).toBe(false);
    });

    it("rejects unknown fields (strict envelope)", () => {
        expect(createTrainingSessionRequestSchema.safeParse({ startedAt: "2026-08-02T10:00:00.000Z" }).success).toBe(
            false,
        );
    });

    it("accepts a complete request with an explicit end and post ratings", () => {
        const parsed = completeTrainingSessionRequestSchema.parse({
            endedAt: "2026-08-02T11:30:00.000Z",
            durationMinutes: 60,
            postWorkout: { enjoyment: 5, notes: "great" },
        });
        expect(parsed.durationMinutes).toBe(60);
    });

    it("validates pain record severity range and side enum", () => {
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "left", severity: 3 }).success,
        ).toBe(true);
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "left", severity: 11 }).success,
        ).toBe(false);
        expect(
            painRecordRequestSchema.safeParse({ id: uuid, bodyArea: "Knee", side: "middle", severity: 3 }).success,
        ).toBe(false);
    });

    it("allows an empty update patch", () => {
        expect(updateTrainingSessionRequestSchema.parse({})).toEqual({});
    });

    it("round-trips a full detail response", () => {
        const response = {
            id: uuid,
            profileId: "0198a4db-d8da-7000-8000-0000000000d9",
            status: "completed",
            title: null,
            localDate: "2026-08-02",
            timeZone: "Europe/Sofia",
            startedAt: "2026-08-02T10:00:00.000Z",
            endedAt: "2026-08-02T11:00:00.000Z",
            durationMinutes: 60,
            readiness: { energy: 4, motivation: null, fatigue: null, soreness: null, stress: null, recovery: null },
            postWorkout: {
                energy: null,
                motivation: null,
                enjoyment: 5,
                difficulty: null,
                fatigue: null,
                notes: null,
            },
            notes: null,
            tags: ["Push"],
            sourcePlannedSessionId: null,
            version: 3,
            archivedAt: null,
            createdAt: "2026-08-02T09:00:00.000Z",
            updatedAt: "2026-08-02T11:00:00.000Z",
            activities: [
                {
                    id: activityId,
                    type: "strength",
                    position: 0,
                    startedAt: null,
                    endedAt: null,
                    durationSeconds: null,
                    rpe: 8,
                    feeling: null,
                    notes: null,
                    tags: [],
                },
            ],
            painRecords: [],
        };
        expect(trainingSessionResponseSchema.parse(response)).toEqual(response);
    });
});
