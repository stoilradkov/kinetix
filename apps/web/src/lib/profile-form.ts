import {
    distanceUnitSchema,
    lengthUnitSchema,
    massUnitSchema,
    profileSexSchema,
    type CoreProfileResponse,
    type CreateProfileRequest,
    type UpdateProfileRequest,
} from "@kinetix/types";
import { z } from "zod";

export const SEX_UNSPECIFIED = "unspecified";

export const profileFormSchema = z.object({
    timeZone: z.string().trim().min(1, "Time zone is required"),
    mass: massUnitSchema,
    distance: distanceUnitSchema,
    length: lengthUnitSchema,
    birthDate: z
        .string()
        .trim()
        .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use the YYYY-MM-DD format"),
    sex: z.union([z.literal(SEX_UNSPECIFIED), profileSexSchema]),
    heightMeters: z
        .string()
        .trim()
        .regex(/^(\d+(\.\d{1,3})?)?$/, "Enter metres with up to three decimals"),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

function localTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

export function profileFormDefaults(profile?: CoreProfileResponse | null): ProfileFormValues {
    return {
        timeZone: profile?.timeZone ?? localTimeZone(),
        mass: profile?.unitPreferences.mass ?? "kg",
        distance: profile?.unitPreferences.distance ?? "km",
        length: profile?.unitPreferences.length ?? "cm",
        birthDate: profile?.birthDate ?? "",
        sex: profile?.sex ?? SEX_UNSPECIFIED,
        heightMeters: profile?.heightMeters ?? "",
    };
}

function unitPreferences(values: ProfileFormValues) {
    return { mass: values.mass, distance: values.distance, length: values.length };
}

export function profileCreateInput(values: ProfileFormValues): CreateProfileRequest {
    return {
        timeZone: values.timeZone.trim(),
        unitPreferences: unitPreferences(values),
        ...(values.birthDate.trim() ? { birthDate: values.birthDate.trim() } : {}),
        ...(values.sex !== SEX_UNSPECIFIED ? { sex: values.sex } : {}),
        ...(values.heightMeters.trim() ? { heightMeters: values.heightMeters.trim() } : {}),
    };
}

export function profileUpdateInput(values: ProfileFormValues): UpdateProfileRequest {
    return {
        timeZone: values.timeZone.trim(),
        unitPreferences: unitPreferences(values),
        birthDate: values.birthDate.trim() ? values.birthDate.trim() : null,
        sex: values.sex !== SEX_UNSPECIFIED ? values.sex : null,
        heightMeters: values.heightMeters.trim() ? values.heightMeters.trim() : null,
    };
}
