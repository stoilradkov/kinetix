import { describe, expect, it, vi } from "vitest";

import type {
    SessionPrescriptionRepository,
    WorkoutTemplateCommands,
    WorkoutTemplateDetail,
    WorkoutTemplateRepository,
    WorkoutTemplateResource,
} from "#src/modules/training/application/index";
import { WorkoutTemplateNotFoundError } from "#src/modules/training/application/index";
import {
    SessionPrescription,
    type ExerciseSnapshotV1,
    type IdMinter,
    type PublishPrescriptionDraft,
    type SessionPrescriptionState,
} from "#src/modules/training/domain/index";
import { WorkoutTemplateController } from "#src/modules/training/presentation/index";
import { ExpectedVersionRequiredError } from "#src/platform/application/index";

const ids = {
    template: "0198a4db-d8da-7000-8000-000000004001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
    exercise: "0198a4db-d8da-7000-8000-0000000000a1",
};
const now = new Date("2026-07-29T12:00:00.000Z");

function snapshot(): ExerciseSnapshotV1 {
    return {
        schemaVersion: 1,
        exerciseId: ids.exercise,
        exerciseVersion: 1,
        name: "Back Squat",
        equipmentTypeId: "0198a4db-d8da-7000-8000-0000000000b1",
        movementPatternId: "0198a4db-d8da-7000-8000-0000000000c1",
        classification: "compound",
        laterality: "bilateral",
        bodyPosition: "standing",
        repetitionSemantics: "total",
        loadModel: "external_only",
        supportedMeasurements: ["repetitions", "external_load"],
        muscles: [],
        tagIds: [],
        analyticsFamilyExerciseIds: [],
    };
}

function prescriptionState(): SessionPrescriptionState {
    const draft: PublishPrescriptionDraft = {
        kind: "template",
        activities: [
            {
                ref: "a1",
                type: "strength",
                position: 0,
                strength: {
                    exercises: [
                        {
                            ref: "e1",
                            exerciseId: ids.exercise,
                            snapshot: snapshot(),
                            position: 0,
                            sets: [{ ref: "s1", position: 0, setType: "working", targets: { repsMin: 5, repsMax: 5 } }],
                        },
                    ],
                },
            },
        ],
    };
    let counter = 0;
    const minter: IdMinter = {
        rowId: () => `0198a4db-d8da-7000-8000-${(++counter).toString(16).padStart(12, "0")}`,
        logicalKey: () => `0198a4db-d8da-7000-8000-${(++counter).toString(16).padStart(12, "0")}`,
    };
    return SessionPrescription.publishDraft(draft, minter, now).state;
}

const prescription = prescriptionState();

function templateResource(overrides: Partial<WorkoutTemplateResource> = {}): WorkoutTemplateResource {
    return {
        id: ids.template,
        profileId: ids.profile,
        name: "Upper A",
        description: null,
        currentPrescriptionId: prescription.id,
        status: "active",
        archivedAt: null,
        version: 1,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
        ...overrides,
    };
}

function detail(overrides: Partial<WorkoutTemplateResource> = {}): WorkoutTemplateDetail {
    return { template: templateResource(overrides), prescription };
}

function repository(overrides: Partial<WorkoutTemplateRepository> = {}): WorkoutTemplateRepository {
    return {
        readTemplate: async () => templateResource(),
        listTemplates: async () => [templateResource()],
        ...overrides,
    } as unknown as WorkoutTemplateRepository;
}

function prescriptions(): SessionPrescriptionRepository {
    return {
        loadTree: async () => prescription,
        loadTrees: async () => [prescription],
    } as unknown as SessionPrescriptionRepository;
}

function controller(overrides: {
    commands?: Partial<WorkoutTemplateCommands>;
    repository?: WorkoutTemplateRepository;
}): WorkoutTemplateController {
    return new WorkoutTemplateController(
        (overrides.commands ?? {}) as WorkoutTemplateCommands,
        overrides.repository ?? repository(),
        prescriptions(),
    );
}

describe("WorkoutTemplateController", () => {
    it("lists template summaries without embedding the prescription tree", async () => {
        const result = await controller({}).list(undefined);
        expect(result).toMatchObject({ items: [{ id: ids.template }] });
        expect(result.items[0]).not.toHaveProperty("prescription");
    });

    it("creates a template, embedding the published prescription and returning its ETag", async () => {
        const create = vi.fn(async () => detail());
        const response = { setHeader: vi.fn() };
        const result = await controller({ commands: { create } }).create(
            { name: "Upper A", prescription: { activities: [] } },
            "request-1",
            undefined,
            response,
        );
        expect(result).toMatchObject({ id: ids.template, version: 1 });
        expect(result.prescription.id).toBe(prescription.id);
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("gets a template with its current prescription and ETag", async () => {
        const response = { setHeader: vi.fn() };
        const result = await controller({}).get(ids.template, response);
        expect(result.prescription.activities).toHaveLength(1);
        expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
    });

    it("archives through the command", async () => {
        const archive = vi.fn(async () =>
            detail({ status: "archived", archivedAt: "2026-07-29T12:00:00.000Z", version: 2 }),
        );
        const result = await controller({ commands: { archive } }).archive(ids.template, '"1"', "r", undefined, {
            setHeader: vi.fn(),
        });
        expect(result).toMatchObject({ status: "archived", version: 2 });
        expect(archive).toHaveBeenCalledWith(ids.template, 1, expect.any(Object), undefined);
    });

    it("requires If-Match on update and reports an unknown template", async () => {
        expect(() =>
            controller({}).update(ids.template, { name: "x" }, undefined, "r", undefined, { setHeader: vi.fn() }),
        ).toThrow(ExpectedVersionRequiredError);
        await expect(
            controller({ repository: repository({ readTemplate: async () => null }) }).get(ids.template, {
                setHeader: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(WorkoutTemplateNotFoundError);
    });
});
