import { describe, expect, it } from "vitest";

import {
    RECORD_ESTIMATED_1RM,
    RECORD_EXERCISE_VOLUME,
    RECORD_MAX_LOAD,
    RECORD_REP_MAX_AT_LOAD,
    RECORD_SCOPE_EXERCISE,
    RECORD_SCOPE_FAMILY,
    computePersonalRecords,
    familyRepresentative,
    type PerformedSetMeasurements,
    type PerformedSetState,
    type PerformedSetType,
    type PersonalRecordsConfig,
    type PersonalRecordsScope,
    type RecordFinding,
    type RecordSetInput,
} from "#src/modules/training/domain/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;

const PROFILE = id(600);
const EX_A = id(1);
const EX_B = id(2);

const CONFIG: PersonalRecordsConfig = { repMin: 1, repCutoff: 12 };

function measurements(overrides: Partial<PerformedSetMeasurements> = {}): PerformedSetMeasurements {
    return {
        reps: null,
        externalLoad: null,
        bodyweight: null,
        addedLoad: null,
        assistanceLoad: null,
        effectiveLoad: null,
        duration: null,
        distance: null,
        powerWatts: null,
        rpe: null,
        rir: null,
        tempo: null,
        restBefore: null,
        restAfter: null,
        ...overrides,
    };
}

let setCounter = 100;
function set(
    measure: Partial<PerformedSetMeasurements>,
    overrides: Partial<PerformedSetState> = {},
): PerformedSetState {
    return {
        id: id(setCounter++),
        setGroupId: null,
        round: null,
        position: 0,
        setType: "working" as PerformedSetType,
        status: "completed",
        measurements: measurements(measure),
        failureReason: null,
        technique: null,
        discomfort: null,
        pump: null,
        notes: null,
        ...overrides,
    };
}

let sessionCounter = 500;
function input(
    loadKg: number | null,
    reps: number | null,
    overrides: Partial<RecordSetInput> = {},
    setOverrides: Partial<PerformedSetState> = {},
): RecordSetInput {
    return {
        sessionId: id(sessionCounter++),
        sessionVersion: 1,
        localDate: "2026-03-16",
        exerciseId: EX_A,
        exerciseVersion: 1,
        loadModel: "external_only",
        repetitionSemantics: "total",
        set: set(
            {
                ...(loadKg === null ? {} : { externalLoad: { value: loadKg, unit: "kg" } }),
                ...(reps === null ? {} : { reps }),
            },
            setOverrides,
        ),
        ...overrides,
    };
}

const exerciseScope: PersonalRecordsScope = {
    aggregation: "exercise",
    scopeType: RECORD_SCOPE_EXERCISE,
    profileId: PROFILE,
    representativeId: EX_A,
    memberExerciseIds: [EX_A],
};

function record(findings: RecordFinding[], key: string, dims: Record<string, string> = {}): RecordFinding | undefined {
    return findings.find(
        finding => finding.findingKey === key && Object.entries(dims).every(([k, v]) => finding.dimensions[k] === v),
    );
}

describe("computePersonalRecords — max load", () => {
    it("takes the heaviest eligible set regardless of reps", () => {
        const sets = [input(100, 5), input(140, 1), input(120, 8)];
        const findings = computePersonalRecords(exerciseScope, sets, CONFIG);
        const maxLoad = record(findings, RECORD_MAX_LOAD)!;
        expect(maxLoad.numeric).toBe(140);
        expect(maxLoad.unit).toBe("kg");
        expect(maxLoad.scope).toEqual({ type: RECORD_SCOPE_EXERCISE, id: `${PROFILE}:${EX_A}` });
        expect(maxLoad.evidence).toMatchObject({ aggregation: "exercise", exerciseId: EX_A });
    });

    it("excludes warm-ups and sets missing load", () => {
        const sets = [input(200, 3, {}, { setType: "warm_up" }), input(null, 5), input(90, 5)];
        const maxLoad = record(computePersonalRecords(exerciseScope, sets, CONFIG), RECORD_MAX_LOAD)!;
        expect(maxLoad.numeric).toBe(90);
    });
});

describe("computePersonalRecords — estimated 1RM", () => {
    it("takes the highest primary estimate over 1RM-eligible sets and exposes formulas", () => {
        const sets = [input(100, 5), input(140, 1)];
        const est = record(computePersonalRecords(exerciseScope, sets, CONFIG), RECORD_ESTIMATED_1RM)!;
        // 140 × 1 primary is 140-ish vs 100 × 5 primary 116.63
        expect(est.numeric).toBeGreaterThan(116.63);
        expect(est.evidence.formulas).toMatchObject({ epley: expect.any(Number) });
    });

    it("ignores sets above the configured repetition cutoff", () => {
        const findings = computePersonalRecords(exerciseScope, [input(60, 20)], CONFIG);
        expect(record(findings, RECORD_ESTIMATED_1RM)).toBeUndefined();
    });
});

describe("computePersonalRecords — rep max at load", () => {
    it("emits the most reps performed at each distinct load", () => {
        const sets = [input(100, 5), input(100, 8), input(120, 3)];
        const findings = computePersonalRecords(exerciseScope, sets, CONFIG);
        expect(record(findings, RECORD_REP_MAX_AT_LOAD, { load: "100.00" })!.numeric).toBe(8);
        expect(record(findings, RECORD_REP_MAX_AT_LOAD, { load: "120.00" })!.numeric).toBe(3);
    });
});

describe("computePersonalRecords — exercise volume", () => {
    it("takes the highest single-session volume", () => {
        const heavy = id(700);
        const sets = [
            input(100, 5, { sessionId: heavy, localDate: "2026-03-10" }),
            input(100, 5, { sessionId: heavy, localDate: "2026-03-10" }),
            input(100, 5, { sessionId: id(701), localDate: "2026-03-12" }),
        ];
        const volume = record(computePersonalRecords(exerciseScope, sets, CONFIG), RECORD_EXERCISE_VOLUME)!;
        expect(volume.numeric).toBe(1000); // 2 × (100 × 5)
        expect(volume.evidence).toMatchObject({ sessionId: heavy, setCount: 2 });
    });
});

describe("computePersonalRecords — determinism and no-regression", () => {
    it("keeps the earliest achievement on a tie", () => {
        const early = input(100, 5, { sessionId: id(800), localDate: "2026-01-01" });
        const late = input(100, 5, { sessionId: id(801), localDate: "2026-05-01" });
        const maxLoad = record(computePersonalRecords(exerciseScope, [late, early], CONFIG), RECORD_MAX_LOAD)!;
        expect(maxLoad.evidence.sessionId).toBe(id(800));
    });

    it("a later lesser set never lowers the record", () => {
        const sets = [input(140, 3, { localDate: "2026-01-01" }), input(90, 3, { localDate: "2026-06-01" })];
        expect(record(computePersonalRecords(exerciseScope, sets, CONFIG), RECORD_MAX_LOAD)!.numeric).toBe(140);
    });
});

describe("computePersonalRecords — family aggregation is labelled", () => {
    it("aggregates over member exercises and labels the family", () => {
        const familyScope: PersonalRecordsScope = {
            aggregation: "family",
            scopeType: RECORD_SCOPE_FAMILY,
            profileId: PROFILE,
            representativeId: familyRepresentative([EX_A, EX_B]),
            memberExerciseIds: [EX_A, EX_B],
        };
        const sets = [input(100, 5, { exerciseId: EX_A }), input(150, 3, { exerciseId: EX_B })];
        const maxLoad = record(computePersonalRecords(familyScope, sets, CONFIG), RECORD_MAX_LOAD)!;
        expect(maxLoad.numeric).toBe(150);
        expect(maxLoad.dimensions.aggregation).toBe("family");
        expect(maxLoad.evidence).toMatchObject({ aggregation: "family", familyExerciseIds: [EX_A, EX_B] });
    });
});

describe("familyRepresentative", () => {
    it("is the lexicographically smallest member id", () => {
        expect(familyRepresentative([EX_B, EX_A])).toBe(EX_A);
    });
});
