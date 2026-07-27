import { describe, expect, it } from "vitest";

import type { CoreProfileResponse } from "@kinetix/types";

import {
    profileCreateInput,
    profileFormDefaults,
    profileFormSchema,
    profileUpdateInput,
    type ProfileFormValues,
} from "@/lib/profile-form";

const profile: CoreProfileResponse = {
    id: "0198a4db-d8da-7000-8000-000000000001",
    status: "active",
    birthDate: "1990-05-14",
    sex: "female",
    heightMeters: "1.780",
    timeZone: "Europe/Sofia",
    unitPreferences: { mass: "lb", distance: "mi", length: "in" },
    version: 3,
    archivedAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
};

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
    return {
        timeZone: "Europe/Sofia",
        mass: "kg",
        distance: "km",
        length: "cm",
        birthDate: "",
        sex: "unspecified",
        heightMeters: "",
        ...overrides,
    };
}

describe("profile form mappers", () => {
    it("defaults an existing profile back into form values", () => {
        expect(profileFormDefaults(profile)).toMatchObject({
            timeZone: "Europe/Sofia",
            mass: "lb",
            distance: "mi",
            length: "in",
            birthDate: "1990-05-14",
            sex: "female",
            heightMeters: "1.780",
        });
    });

    it("defaults a missing profile with metric units and blank optionals", () => {
        expect(profileFormDefaults(null)).toMatchObject({
            mass: "kg",
            distance: "km",
            length: "cm",
            birthDate: "",
            sex: "unspecified",
            heightMeters: "",
        });
    });

    it("omits blank optionals when creating", () => {
        expect(profileCreateInput(values({ birthDate: "  ", heightMeters: "" }))).toEqual({
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", length: "cm" },
        });
    });

    it("clears blank optionals with explicit null when updating", () => {
        expect(profileUpdateInput(values({ sex: "unspecified", birthDate: "", heightMeters: "" }))).toEqual({
            timeZone: "Europe/Sofia",
            unitPreferences: { mass: "kg", distance: "km", length: "cm" },
            birthDate: null,
            sex: null,
            heightMeters: null,
        });
    });

    it("keeps provided optionals when updating", () => {
        expect(profileUpdateInput(values({ sex: "male", birthDate: "1988-01-02", heightMeters: "1.9" }))).toMatchObject(
            {
                birthDate: "1988-01-02",
                sex: "male",
                heightMeters: "1.9",
            },
        );
    });
});

describe("profile form birth-date validation", () => {
    const base = { timeZone: "UTC", mass: "kg", distance: "km", length: "cm", sex: "unspecified", heightMeters: "" };

    it("accepts a blank or real past date", () => {
        expect(profileFormSchema.safeParse({ ...base, birthDate: "" }).success).toBe(true);
        expect(profileFormSchema.safeParse({ ...base, birthDate: "1990-05-14" }).success).toBe(true);
    });

    it("rejects impossible or future dates", () => {
        expect(profileFormSchema.safeParse({ ...base, birthDate: "9999-99-99" }).success).toBe(false);
        expect(profileFormSchema.safeParse({ ...base, birthDate: "2020-02-30" }).success).toBe(false);
        expect(profileFormSchema.safeParse({ ...base, birthDate: "2999-01-01" }).success).toBe(false);
    });
});
