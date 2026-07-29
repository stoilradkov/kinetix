import { describe, expect, it } from "vitest";

import { GearItem, type CreateGearItemInput } from "#src/modules/training/domain/index";

const ids = {
    gear: "0198a4db-d8da-7000-8000-000000003001",
    profile: "0198a4db-d8da-7000-8000-0000000000d9",
} as const;
const now = new Date("2026-07-28T12:00:00.000Z");

function input(overrides: Partial<CreateGearItemInput> = {}): CreateGearItemInput {
    return { id: ids.gear, profileId: ids.profile, name: "Daily Trainers", gearType: "shoes", ...overrides };
}

describe("GearItem domain", () => {
    it("creates active gear and converts a distance limit to metres", () => {
        const state = GearItem.create(input({ distanceLimit: { value: 800, unit: "km" } }), now).state;
        expect(state).toMatchObject({ status: "active", archivedAt: null, distanceLimitM: "800000" });
    });

    it("rejects a retirement before acquisition and a non-positive distance limit", () => {
        expect(() => GearItem.create(input({ acquiredOn: "2026-05-01", retiredOn: "2026-04-01" }), now)).toThrow();
        expect(() => GearItem.create(input({ distanceLimit: { value: 0, unit: "km" } }), now)).toThrow();
    });

    it("archives and restores, toggling the archive timestamp", () => {
        const created = GearItem.create(input(), now);
        const archived = GearItem.rehydrate(created.state).archive(now).state;
        expect(archived).toMatchObject({ status: "archived" });
        expect(archived.archivedAt).not.toBeNull();
        const restored = GearItem.rehydrate(archived).restore(now).state;
        expect(restored).toMatchObject({ status: "active", archivedAt: null });
    });
});
