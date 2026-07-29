import { z } from "zod";

import { exerciseSnapshotV1Schema } from "#src/training-catalog";

/**
 * Versioned wire contracts for immutable prescription trees (ADR 0003), shared by the
 * template, program, bulk, and session-mapping endpoints built in later issues.
 *
 * Lineage selectors are explicit fields: draft/request nodes expose only `logicalKey`
 * (retain selector) and `sourceLogicalKey`, never an infrastructure row `id`. Draft
 * cross-references use a caller-assigned draft-local `ref`. Response nodes expose the
 * published `id`, `logicalKey`, `sourceLogicalKey`, and `sourceRowId`.
 */

export const prescriptionKindSchema = z.enum(["template", "planned", "resolved_execution"]);
export const prescribedActivityTypeSchema = z.enum(["strength", "running"]);
export const prescribedSetGroupTypeSchema = z.enum([
    "straight",
    "superset",
    "circuit",
    "drop",
    "cluster",
    "rest_pause",
]);
export const prescribedSetTypeSchema = z.enum([
    "warm_up",
    "working",
    "back_off",
    "drop",
    "failure_amrap",
    "superset_circuit",
    "rest_pause",
    "technique",
    "cluster",
    "other",
]);
export const prescribedRunStepTypeSchema = z.enum(["warm_up", "work", "recovery", "repeat", "cool_down", "open"]);
export const substitutionPolicySchema = z.enum(["none", "same_pattern", "same_muscle", "free"]);

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal");
const nonNegativeInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const ms = z.number().int().nonnegative();
const optionalUuid = z.string().uuid().optional();
const ref = z.string().min(1).max(120);

const tempoSchema = z
    .object({
        eccentricMs: ms.nullable(),
        bottomPauseMs: ms.nullable(),
        concentricMs: ms.nullable(),
        topPauseMs: ms.nullable(),
    })
    .partial()
    .strict();

const targetRangesShape = {
    repsMin: nonNegativeInt.nullable().optional(),
    repsMax: nonNegativeInt.nullable().optional(),
    loadKgMin: decimalString.nullable().optional(),
    loadKgMax: decimalString.nullable().optional(),
    durationMsMin: ms.nullable().optional(),
    durationMsMax: ms.nullable().optional(),
    distanceMMin: decimalString.nullable().optional(),
    distanceMMax: decimalString.nullable().optional(),
    speedMpsMin: decimalString.nullable().optional(),
    speedMpsMax: decimalString.nullable().optional(),
    powerWMin: decimalString.nullable().optional(),
    powerWMax: decimalString.nullable().optional(),
    rpeMin: decimalString.nullable().optional(),
    rpeMax: decimalString.nullable().optional(),
    rirMin: nonNegativeInt.nullable().optional(),
    rirMax: nonNegativeInt.nullable().optional(),
    hrBpmMin: nonNegativeInt.nullable().optional(),
    hrBpmMax: nonNegativeInt.nullable().optional(),
    percent1rm: decimalString.nullable().optional(),
    percentTrainingMax: decimalString.nullable().optional(),
    tempo: tempoSchema.nullable().optional(),
    restMsMin: ms.nullable().optional(),
    restMsMax: ms.nullable().optional(),
    enteredTargets: z.record(z.string(), z.unknown()).optional(),
} as const;

type TargetRangesInput = { [K in keyof typeof targetRangesShape]?: unknown } & {
    readonly [pair: string]: unknown;
};

const rangePairs: ReadonlyArray<readonly [string, string]> = [
    ["repsMin", "repsMax"],
    ["loadKgMin", "loadKgMax"],
    ["durationMsMin", "durationMsMax"],
    ["distanceMMin", "distanceMMax"],
    ["speedMpsMin", "speedMpsMax"],
    ["powerWMin", "powerWMax"],
    ["rpeMin", "rpeMax"],
    ["rirMin", "rirMax"],
    ["hrBpmMin", "hrBpmMax"],
    ["restMsMin", "restMsMax"],
];

function assertTargets(value: TargetRangesInput, ctx: z.RefinementCtx): void {
    for (const [minKey, maxKey] of rangePairs) {
        const min = value[minKey];
        const max = value[maxKey];
        if (min != null && max != null && Number(min) > Number(max))
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [minKey],
                message: `${minKey} cannot exceed ${maxKey}`,
            });
    }
    const loadModes =
        (value.loadKgMin != null || value.loadKgMax != null ? 1 : 0) +
        (value.percent1rm != null ? 1 : 0) +
        (value.percentTrainingMax != null ? 1 : 0);
    if (loadModes > 1)
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["loadKgMin"],
            message: "Use only one of absolute load, percent of 1RM, or percent of training max",
        });
}

export const prescriptionTargetRangesSchema = z
    .object(targetRangesShape)
    .strict()
    .superRefine((value, ctx) => assertTargets(value, ctx));

// --- request (draft) contracts ---------------------------------------------------------

const draftNodeBase = { ref, logicalKey: optionalUuid, sourceLogicalKey: optionalUuid };

const prescribedSetDraftSchema = z
    .object({
        ...draftNodeBase,
        setGroupRef: ref.nullable().optional(),
        position: nonNegativeInt,
        round: positiveInt.nullable().optional(),
        setType: prescribedSetTypeSchema,
        targets: prescriptionTargetRangesSchema.optional(),
        notes: z.string().max(500).nullable().optional(),
    })
    .strict();

const prescribedExerciseDraftSchema = z
    .object({
        ...draftNodeBase,
        exerciseId: z.string().uuid(),
        snapshot: exerciseSnapshotV1Schema,
        position: nonNegativeInt,
        purpose: z.string().max(500).nullable().optional(),
        substitutionPolicy: substitutionPolicySchema.nullable().optional(),
        sets: z.array(prescribedSetDraftSchema),
    })
    .strict();

const prescribedSetGroupDraftSchema = z
    .object({
        ...draftNodeBase,
        parentGroupRef: ref.nullable().optional(),
        type: prescribedSetGroupTypeSchema,
        position: nonNegativeInt,
        rounds: positiveInt.nullable().optional(),
        restMs: ms.nullable().optional(),
        members: z.array(z.object({ exerciseRef: ref, position: nonNegativeInt }).strict()),
    })
    .strict();

const prescribedRunStepDraftSchema = z
    .object({
        ...draftNodeBase,
        parentStepRef: ref.nullable().optional(),
        type: prescribedRunStepTypeSchema,
        position: nonNegativeInt,
        repeatCount: positiveInt.nullable().optional(),
        targets: prescriptionTargetRangesSchema.optional(),
        notes: z.string().max(500).nullable().optional(),
    })
    .strict();

const prescribedActivityDraftSchema = z.discriminatedUnion("type", [
    z
        .object({
            ...draftNodeBase,
            type: z.literal("strength"),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable().optional(),
            rpeTarget: decimalString.nullable().optional(),
            notes: z.string().max(500).nullable().optional(),
            strength: z
                .object({
                    exercises: z.array(prescribedExerciseDraftSchema),
                    setGroups: z.array(prescribedSetGroupDraftSchema).optional(),
                })
                .strict(),
        })
        .strict(),
    z
        .object({
            ...draftNodeBase,
            type: z.literal("running"),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable().optional(),
            rpeTarget: decimalString.nullable().optional(),
            notes: z.string().max(500).nullable().optional(),
            running: z
                .object({
                    runTags: z.array(z.string().min(1).max(60)).optional(),
                    overallTargets: prescriptionTargetRangesSchema.optional(),
                    steps: z.array(prescribedRunStepDraftSchema),
                })
                .strict(),
        })
        .strict(),
]);

export const publishPrescriptionRequestSchema = z
    .object({
        kind: prescriptionKindSchema,
        expectedDurationMs: ms.nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        sourcePrescriptionId: z.string().uuid().nullable().optional(),
        sourceKind: prescriptionKindSchema.nullable().optional(),
        activities: z.array(prescribedActivityDraftSchema),
    })
    .strict();

export const clonePrescriptionRequestSchema = z
    .object({
        sourcePrescriptionId: z.string().uuid(),
        targetKind: prescriptionKindSchema,
        preserveLogicalKeys: z.boolean().optional(),
    })
    .strict();

// --- response contracts ----------------------------------------------------------------

const responseNodeBase = {
    id: z.string().uuid(),
    logicalKey: z.string().uuid(),
    sourceLogicalKey: z.string().uuid().nullable(),
    sourceRowId: z.string().uuid().nullable(),
};

const prescribedSetResponseSchema = z
    .object({
        ...responseNodeBase,
        setGroupLogicalKey: z.string().uuid().nullable(),
        position: nonNegativeInt,
        round: positiveInt.nullable(),
        setType: prescribedSetTypeSchema,
        targets: prescriptionTargetRangesSchema,
        notes: z.string().nullable(),
    })
    .strict();

const prescribedExerciseResponseSchema = z
    .object({
        ...responseNodeBase,
        exerciseId: z.string().uuid(),
        snapshot: exerciseSnapshotV1Schema,
        position: nonNegativeInt,
        purpose: z.string().nullable(),
        substitutionPolicy: substitutionPolicySchema.nullable(),
        sets: z.array(prescribedSetResponseSchema),
    })
    .strict();

const prescribedSetGroupResponseSchema = z
    .object({
        ...responseNodeBase,
        parentGroupLogicalKey: z.string().uuid().nullable(),
        type: prescribedSetGroupTypeSchema,
        position: nonNegativeInt,
        rounds: positiveInt.nullable(),
        restMs: ms.nullable(),
        members: z.array(z.object({ exerciseLogicalKey: z.string().uuid(), position: nonNegativeInt }).strict()),
    })
    .strict();

const prescribedRunStepResponseSchema = z
    .object({
        ...responseNodeBase,
        parentStepLogicalKey: z.string().uuid().nullable(),
        type: prescribedRunStepTypeSchema,
        position: nonNegativeInt,
        repeatCount: positiveInt.nullable(),
        targets: prescriptionTargetRangesSchema,
        notes: z.string().nullable(),
    })
    .strict();

const prescribedActivityResponseSchema = z.discriminatedUnion("type", [
    z
        .object({
            ...responseNodeBase,
            type: z.literal("strength"),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable(),
            rpeTarget: decimalString.nullable(),
            notes: z.string().nullable(),
            strength: z
                .object({
                    exercises: z.array(prescribedExerciseResponseSchema),
                    setGroups: z.array(prescribedSetGroupResponseSchema),
                })
                .strict(),
            running: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseNodeBase,
            type: z.literal("running"),
            position: nonNegativeInt,
            expectedDurationMs: ms.nullable(),
            rpeTarget: decimalString.nullable(),
            notes: z.string().nullable(),
            strength: z.null(),
            running: z
                .object({
                    runTags: z.array(z.string()),
                    overallTargets: prescriptionTargetRangesSchema,
                    steps: z.array(prescribedRunStepResponseSchema),
                })
                .strict(),
        })
        .strict(),
]);

export const sessionPrescriptionResponseSchema = z
    .object({
        id: z.string().uuid(),
        kind: prescriptionKindSchema,
        schemaVersion: z.literal(1),
        expectedDurationMs: ms.nullable(),
        notes: z.string().nullable(),
        sourcePrescriptionId: z.string().uuid().nullable(),
        sourceKind: prescriptionKindSchema.nullable(),
        activities: z.array(prescribedActivityResponseSchema),
        createdAt: z.string().datetime(),
    })
    .strict();

export type PrescriptionKindValue = z.infer<typeof prescriptionKindSchema>;
export type PrescriptionTargetRanges = z.infer<typeof prescriptionTargetRangesSchema>;
export type PublishPrescriptionRequest = z.infer<typeof publishPrescriptionRequestSchema>;
export type ClonePrescriptionRequest = z.infer<typeof clonePrescriptionRequestSchema>;
export type SessionPrescriptionResponse = z.infer<typeof sessionPrescriptionResponseSchema>;
