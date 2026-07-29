import { describe, expect, it } from "vitest";

import { recordZoneDefinitionRequestSchema } from "@kinetix/types";

import { zoneFormDefaults, zoneFormSchema, zoneRecordInput, type ZoneFormValues } from "@/lib/zone-form";

function values(overrides: Partial<ZoneFormValues> = {}): ZoneFormValues {
    return { ...zoneFormDefaults(), ...overrides };
}

describe("zone form mappers", () => {
    it("maps ranges with positions and a null open top", () => {
        const input = zoneRecordInput(values());
        expect(input.ranges).toEqual([
            { position: 0, name: "Zone 1", lowerBound: 0, upperBound: 120 },
            { position: 1, name: "Zone 2", lowerBound: 120, upperBound: null },
        ]);
        expect(recordZoneDefinitionRequestSchema.safeParse(input).success).toBe(true);
    });

    it("includes only the config keys a method needs", () => {
        const input = zoneRecordInput(values({ method: "percent_max_hr", config: { maxHr: "190", ftpW: "250" } }));
        expect(input.config).toEqual({ maxHr: 190 });
        expect(recordZoneDefinitionRequestSchema.safeParse(input).success).toBe(true);
    });

    it("rejects a method that does not match the family", () => {
        expect(zoneFormSchema.safeParse(values({ family: "power", method: "percent_max_hr" })).success).toBe(false);
    });
});
