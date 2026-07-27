import { describe, expect, it } from "vitest";

import { CoreProfile, type CreateCoreProfileInput, type UnitPreferences } from "#src/modules/profile/domain/index";

const profileId = "0198a4db-d8da-7000-8000-000000000001";
const now = new Date("2026-07-27T12:00:00.000Z");

const unitPreferences: UnitPreferences = { mass: "kg", distance: "km", length: "cm" };

function input(overrides: Partial<CreateCoreProfileInput> = {}): CreateCoreProfileInput {
    return { id: profileId, timeZone: "Europe/Sofia", unitPreferences, ...overrides };
}

describe("CoreProfile", () => {
    it("creates an active profile with required defaults and absent optionals", () => {
        const profile = CoreProfile.create(input(), now);

        expect(profile.state).toMatchObject({
            id: profileId,
            status: "active",
            birthDate: null,
            sex: null,
            heightMeters: null,
            timeZone: "Europe/Sofia",
            unitPreferences,
            archivedAt: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
    });

    it("keeps optional values structured when provided", () => {
        const profile = CoreProfile.create(
            input({ birthDate: "1990-05-14", sex: "female", heightMeters: "1.780" }),
            now,
        );

        expect(profile.state).toMatchObject({ birthDate: "1990-05-14", sex: "female", heightMeters: "1.780" });
    });

    it("returns an immutable copy of state", () => {
        const profile = CoreProfile.create(input(), now);
        const snapshot = profile.state;
        (snapshot as { timeZone: string }).timeZone = "UTC";

        expect(profile.state.timeZone).toBe("Europe/Sofia");
    });

    it("rejects a required time zone that is not a real IANA zone", () => {
        expect(() => CoreProfile.create(input({ timeZone: "Mars/Olympus" }), now)).toThrow(/valid IANA time zone/i);
    });

    it("rejects an unsupported unit preference", () => {
        expect(() =>
            CoreProfile.create(input({ unitPreferences: { ...unitPreferences, mass: "stone" as never } }), now),
        ).toThrow(/Mass unit/i);
    });

    it("rejects a birth date in the future", () => {
        expect(() => CoreProfile.create(input({ birthDate: "2099-01-01" }), now)).toThrow(/future/i);
    });

    it("rejects an impossible calendar date", () => {
        expect(() => CoreProfile.create(input({ birthDate: "2020-02-30" }), now)).toThrow(/calendar date/i);
    });

    it("rejects a height outside the human range", () => {
        expect(() => CoreProfile.create(input({ heightMeters: "5" }), now)).toThrow(/at most 3/i);
        expect(() => CoreProfile.create(input({ heightMeters: "0" }), now)).toThrow(/greater than 0/i);
        expect(() => CoreProfile.create(input({ heightMeters: "1.7801" }), now)).toThrow(/three decimals/i);
    });

    it("patches only provided fields and clears optionals with explicit null", () => {
        const later = new Date("2026-07-28T09:00:00.000Z");
        const profile = CoreProfile.create(input({ birthDate: "1990-05-14", sex: "male" }), now).update(
            { sex: null, heightMeters: "1.900", timeZone: "UTC" },
            later,
        );

        expect(profile.state).toMatchObject({
            birthDate: "1990-05-14", // untouched (undefined in patch)
            sex: null, // cleared
            heightMeters: "1.900",
            timeZone: "UTC",
            updatedAt: later.toISOString(),
        });
    });

    it("archives and restores while keeping status/archivedAt consistent", () => {
        const profile = CoreProfile.create(input(), now);
        const archived = profile.archive(now);
        expect(archived.state.status).toBe("archived");
        expect(archived.state.archivedAt).toBe(now.toISOString());

        const restored = archived.restore(now);
        expect(restored.state.status).toBe("active");
        expect(restored.state.archivedAt).toBeNull();

        expect(() => restored.restore(now)).toThrow(/already active/i);
    });

    it("rehydrates persisted state and re-validates invariants", () => {
        const state = CoreProfile.create(input({ heightMeters: "1.780" }), now).state;
        expect(CoreProfile.rehydrate(state).state).toEqual(state);
        expect(() => CoreProfile.rehydrate({ ...state, status: "archived", archivedAt: null })).toThrow(
            /archive state is inconsistent/i,
        );
    });
});
