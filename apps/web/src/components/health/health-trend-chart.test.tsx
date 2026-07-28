import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { HealthRecordBodyValue, HealthRecordTypeValue, ManualHealthRecordResponse } from "@kinetix/types";

import { HealthTrendChart } from "@/components/health/health-trend-chart";

function record(id: string, effectiveAt: string, body: HealthRecordBodyValue): ManualHealthRecordResponse {
    return {
        id,
        profileId: "0198a4db-d8da-7000-8000-0000000000b9",
        type: body.type,
        source: "manual",
        effectiveAt,
        timeZone: null,
        notes: null,
        body,
        bodySchemaVersion: 1,
        archivedAt: null,
        version: 1,
        createdAt: effectiveAt,
        updatedAt: effectiveAt,
    };
}

const cases: { type: HealthRecordTypeValue; records: ManualHealthRecordResponse[] }[] = [
    {
        type: "body_weight",
        records: [
            record("a", "2026-07-01T06:00:00.000Z", { type: "body_weight", massKg: 82 }),
            record("b", "2026-07-08T06:00:00.000Z", { type: "body_weight", massKg: 81 }),
        ],
    },
    {
        type: "resting_heart_rate",
        records: [
            record("a", "2026-07-01T06:00:00.000Z", { type: "resting_heart_rate", beatsPerMinute: 54 }),
            record("b", "2026-07-08T06:00:00.000Z", { type: "resting_heart_rate", beatsPerMinute: 51 }),
        ],
    },
    {
        type: "daily_readiness",
        records: [
            record("a", "2026-07-01T06:00:00.000Z", { type: "daily_readiness", score: 70 }),
            record("b", "2026-07-08T06:00:00.000Z", { type: "daily_readiness", score: 80 }),
        ],
    },
    {
        type: "sleep",
        records: [
            record("a", "2026-07-01T06:00:00.000Z", {
                type: "sleep",
                startAt: "2026-06-30T22:00:00.000Z",
                endAt: "2026-07-01T06:00:00.000Z",
            }),
            record("b", "2026-07-02T06:00:00.000Z", {
                type: "sleep",
                startAt: "2026-07-01T23:00:00.000Z",
                endAt: "2026-07-02T06:30:00.000Z",
            }),
        ],
    },
];

describe("HealthTrendChart", () => {
    it.each(cases)("renders a chart for $type with enough readings", ({ type, records }) => {
        const { container } = render(<HealthTrendChart records={records} type={type} />);
        expect(container.textContent).not.toMatch(/at least two/i);
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("shows an empty state with fewer than two readings", () => {
        const { container } = render(
            <HealthTrendChart
                records={[record("a", "2026-07-01T06:00:00.000Z", { type: "body_weight", massKg: 82 })]}
                type="body_weight"
            />,
        );
        expect(container.textContent).toMatch(/at least two weigh-ins/i);
        expect(container.querySelector("svg")).toBeNull();
    });
});
