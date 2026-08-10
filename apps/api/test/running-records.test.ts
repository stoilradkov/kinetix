import { describe, expect, it } from "vitest";

import {
    RECORD_RUNNING_BEST_PACE,
    RECORD_RUNNING_HIGHEST_POWER,
    RECORD_RUNNING_LONGEST_DISTANCE,
    RECORD_RUNNING_LONGEST_DURATION,
    RECORD_RUNNING_STANDARD_DISTANCE,
    RECORD_SCOPE_RUNNING,
    RUNNING_RECORD_DEFAULT_TOLERANCE,
    computeRunningRecords,
    type RecordFinding,
    type RunRecordInput,
    type RunningRecordsConfig,
} from "#src/modules/training/domain/index";

const id = (n: number) => `0198a4db-d8da-7000-8000-${n.toString(16).padStart(12, "0")}`;
const PROFILE = id(600);
const config: RunningRecordsConfig = { standardToleranceFraction: RUNNING_RECORD_DEFAULT_TOLERANCE };

let seq = 0;
function run(overrides: Partial<RunRecordInput>): RunRecordInput {
    seq += 1;
    return {
        sessionId: id(1000 + seq),
        sessionVersion: 1,
        localDate: "2026-08-01",
        activityId: id(2000 + seq),
        distanceMetres: null,
        movingTimeMs: null,
        elapsedTimeMs: null,
        averagePowerW: null,
        maxPowerW: null,
        ...overrides,
    };
}

function byKey(findings: readonly RecordFinding[], key: string): RecordFinding[] {
    return findings.filter(f => f.findingKey === key);
}

describe("computeRunningRecords", () => {
    it("keeps every record under the labelled profile-running scope", () => {
        const findings = computeRunningRecords(
            PROFILE,
            [run({ distanceMetres: 5000, movingTimeMs: 1_500_000 })],
            config,
        );
        for (const finding of findings) expect(finding.scope).toEqual({ type: RECORD_SCOPE_RUNNING, id: PROFILE });
    });

    it("records the longest distance, longest duration, and highest power", () => {
        const runs = [
            run({ distanceMetres: 8000, movingTimeMs: 2_400_000, averagePowerW: 250 }),
            run({ distanceMetres: 12000, movingTimeMs: 3_600_000, averagePowerW: 200 }),
        ];
        const findings = computeRunningRecords(PROFILE, runs, config);
        expect(byKey(findings, RECORD_RUNNING_LONGEST_DISTANCE)[0]!.numeric).toBe(12000);
        expect(byKey(findings, RECORD_RUNNING_LONGEST_DURATION)[0]!.numeric).toBe(3_600_000);
        expect(byKey(findings, RECORD_RUNNING_HIGHEST_POWER)[0]!.numeric).toBe(250);
    });

    it("records the best (fastest) average pace as seconds per kilometre", () => {
        const runs = [
            run({ distanceMetres: 5000, movingTimeMs: 1_500_000 }), // 300 s/km
            run({ distanceMetres: 5000, movingTimeMs: 1_200_000 }), // 240 s/km — faster
        ];
        const best = byKey(computeRunningRecords(PROFILE, runs, config), RECORD_RUNNING_BEST_PACE)[0]!;
        expect(best.numeric).toBe(240);
        expect(best.unit).toBe("s/km");
    });

    it("records the fastest time per standard distance within tolerance", () => {
        const runs = [
            run({ distanceMetres: 5010, movingTimeMs: 1_500_000 }), // within 2% of 5km
            run({ distanceMetres: 4990, movingTimeMs: 1_200_000 }), // within 2% of 5km — faster
            run({ distanceMetres: 3000, movingTimeMs: 900_000 }), // not a standard distance
        ];
        const standard = byKey(computeRunningRecords(PROFILE, runs, config), RECORD_RUNNING_STANDARD_DISTANCE);
        expect(standard).toHaveLength(1);
        expect(standard[0]!.dimensions).toEqual({ distance: "5km" });
        expect(standard[0]!.numeric).toBe(1_200_000);
        expect(standard[0]!.evidence).toMatchObject({ standardDistance: "5km" });
    });

    it("does not match a run outside the comparability tolerance", () => {
        const runs = [run({ distanceMetres: 5500, movingTimeMs: 1_500_000 })]; // 10% over 5km
        expect(byKey(computeRunningRecords(PROFILE, runs, config), RECORD_RUNNING_STANDARD_DISTANCE)).toHaveLength(0);
    });

    it("holds a tie with the earliest achievement (no regression)", () => {
        const early = run({ localDate: "2026-07-01", distanceMetres: 10000, movingTimeMs: 3_000_000 });
        const late = run({ localDate: "2026-08-01", distanceMetres: 10000, movingTimeMs: 3_000_000 });
        const longest = byKey(
            computeRunningRecords(PROFILE, [late, early], config),
            RECORD_RUNNING_LONGEST_DISTANCE,
        )[0]!;
        expect(longest.evidence.sessionId).toBe(early.sessionId);
    });

    it("references the source session revision as an input", () => {
        const sample = run({ sessionVersion: 4, distanceMetres: 5000, movingTimeMs: 1_500_000 });
        const finding = byKey(computeRunningRecords(PROFILE, [sample], config), RECORD_RUNNING_LONGEST_DISTANCE)[0]!;
        expect(finding.inputs).toContainEqual({ entityType: "session", entityId: sample.sessionId, revision: 4 });
    });
});
