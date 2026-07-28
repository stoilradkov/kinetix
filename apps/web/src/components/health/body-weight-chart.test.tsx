import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ManualHealthRecordResponse } from "@kinetix/types";

import { BodyWeightChart } from "@/components/health/body-weight-chart";

function weight(id: string, effectiveAt: string, massKg: number): ManualHealthRecordResponse {
    return {
        id,
        profileId: "0198a4db-d8da-7000-8000-0000000000b9",
        type: "body_weight",
        source: "manual",
        effectiveAt,
        timeZone: null,
        notes: null,
        body: { type: "body_weight", massKg },
        bodySchemaVersion: 1,
        archivedAt: null,
        version: 1,
        createdAt: effectiveAt,
        updatedAt: effectiveAt,
    };
}

describe("BodyWeightChart", () => {
    it("prompts for more data when there are fewer than two readings", () => {
        const { container } = render(<BodyWeightChart records={[weight("a", "2026-07-01T06:00:00.000Z", 82)]} />);
        expect(container.textContent).toMatch(/at least two weigh-ins/i);
        expect(container.querySelector("svg")).toBeNull();
    });

    it("renders a chart once there are enough readings", () => {
        const { container } = render(
            <BodyWeightChart
                records={[
                    weight("a", "2026-07-01T06:00:00.000Z", 82),
                    weight("b", "2026-07-08T06:00:00.000Z", 81.4),
                    weight("c", "2026-07-15T06:00:00.000Z", 81),
                ]}
            />,
        );
        expect(container.textContent).not.toMatch(/at least two weigh-ins/i);
        expect(container.querySelector("svg")).not.toBeNull();
    });
});
