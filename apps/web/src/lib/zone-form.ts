import {
    zoneFamilySchema,
    zoneMethodSchema,
    type RecordZoneDefinitionRequest,
    type ZoneFamilyValue,
    type ZoneMethodValue,
} from "@kinetix/types";
import { z } from "zod";

export const methodsByFamily: Record<ZoneFamilyValue, readonly ZoneMethodValue[]> = {
    heart_rate: ["percent_max_hr", "percent_hr_reserve", "lactate_threshold", "manual"],
    pace: ["percent_threshold_pace", "manual"],
    power: ["percent_ftp", "manual"],
};

/** Config reference keys a method requires, surfaced as optional numeric inputs. */
export const configKeysByMethod: Record<ZoneMethodValue, readonly string[]> = {
    percent_max_hr: ["maxHr"],
    percent_hr_reserve: ["maxHr", "restingHr"],
    lactate_threshold: ["thresholdHr"],
    percent_threshold_pace: ["thresholdPaceMps"],
    percent_ftp: ["ftpW"],
    manual: [],
};

const decimalString = z
    .string()
    .trim()
    .regex(/^(\d+(\.\d{1,4})?)?$/, "Enter a number");

const rangeSchema = z.object({
    name: z.string().trim().min(1, "Name required").max(60),
    lowerBound: decimalString.refine(value => value !== "", "Required"),
    upperBound: decimalString,
});

export const zoneFormSchema = z
    .object({
        family: zoneFamilySchema,
        method: zoneMethodSchema,
        config: z.record(z.string(), decimalString),
        ranges: z.array(rangeSchema).min(1, "Add at least one range"),
        note: z.string().max(500),
    })
    .refine(values => methodsByFamily[values.family].includes(values.method), {
        message: "Method is not valid for this family",
        path: ["method"],
    });

export type ZoneFormValues = z.infer<typeof zoneFormSchema>;

export function zoneFormDefaults(): ZoneFormValues {
    return {
        family: "heart_rate",
        method: "manual",
        config: {},
        ranges: [
            { name: "Zone 1", lowerBound: "0", upperBound: "120" },
            { name: "Zone 2", lowerBound: "120", upperBound: "" },
        ],
        note: "",
    };
}

export function zoneRecordInput(values: ZoneFormValues): RecordZoneDefinitionRequest {
    const config: Record<string, number> = {};
    for (const key of configKeysByMethod[values.method]) {
        const raw = values.config[key];
        if (raw && raw.trim() !== "") config[key] = Number(raw);
    }
    return {
        family: values.family,
        method: values.method,
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ranges: values.ranges.map((range, index) => ({
            position: index,
            name: range.name.trim(),
            lowerBound: Number(range.lowerBound),
            upperBound: range.upperBound.trim() === "" ? null : Number(range.upperBound),
        })),
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
    };
}
