import {
    healthRecordTypeSchema,
    type CreateManualHealthRecordRequest,
    type HealthRecordBodyValue,
    type ManualHealthRecordResponse,
    type UpdateManualHealthRecordRequest,
} from "@kinetix/types";
import { z } from "zod";

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MAX_SLEEP_MINUTES = 24 * 60;

/** A wall-clock `YYYY-MM-DDTHH:MM` string that names a real calendar instant. */
function isRealLocalDateTime(value: string): boolean {
    const match = LOCAL_DATE_TIME.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const date = new Date(year, month - 1, day, hour, minute);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getHours() === hour &&
        date.getMinutes() === minute
    );
}

function pad(value: number, length = 2): string {
    return String(value).padStart(length, "0");
}

/** Convert an ISO instant to a local wall-clock `YYYY-MM-DDTHH:MM` for editing. */
export function toLocalDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert a local wall-clock `YYYY-MM-DDTHH:MM` to an ISO instant. */
export function fromLocalDateTime(local: string): string {
    const match = LOCAL_DATE_TIME.exec(local);
    if (!match) throw new Error(`Invalid local date-time: ${local}`);
    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
    ).toISOString();
}

function localMinutesBetween(start: string, end: string): number {
    return (new Date(fromLocalDateTime(end)).getTime() - new Date(fromLocalDateTime(start)).getTime()) / 60_000;
}

function isValidTimeZone(value: string): boolean {
    if (value === "") return true;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

function isDecimal(value: string): boolean {
    return value.trim() !== "" && Number.isFinite(Number(value));
}

function isInteger(value: string): boolean {
    return value.trim() !== "" && Number.isInteger(Number(value));
}

export const healthRecordFormSchema = z
    .object({
        type: healthRecordTypeSchema,
        effectiveAt: z.string().trim(),
        timeZone: z.string().trim(),
        notes: z.string().max(2_000),
        massKg: z.string().trim(),
        beatsPerMinute: z.string().trim(),
        sleepStart: z.string().trim(),
        sleepEnd: z.string().trim(),
        score: z.string().trim(),
        scaleMin: z.string().trim(),
        scaleMax: z.string().trim(),
    })
    .superRefine((values, ctx) => {
        if (!isValidTimeZone(values.timeZone))
            ctx.addIssue({ code: "custom", message: "Choose a valid time zone", path: ["timeZone"] });

        if (values.type !== "sleep" && !isRealLocalDateTime(values.effectiveAt))
            ctx.addIssue({ code: "custom", message: "Enter a real date and time", path: ["effectiveAt"] });

        switch (values.type) {
            case "body_weight": {
                const mass = Number(values.massKg);
                if (!isDecimal(values.massKg) || mass <= 0 || mass > 1_000)
                    ctx.addIssue({ code: "custom", message: "Enter a weight between 0 and 1000 kg", path: ["massKg"] });
                break;
            }
            case "resting_heart_rate": {
                const bpm = Number(values.beatsPerMinute);
                if (!isInteger(values.beatsPerMinute) || bpm < 20 || bpm > 250)
                    ctx.addIssue({
                        code: "custom",
                        message: "Enter a whole number between 20 and 250",
                        path: ["beatsPerMinute"],
                    });
                break;
            }
            case "sleep": {
                if (!isRealLocalDateTime(values.sleepStart))
                    ctx.addIssue({ code: "custom", message: "Enter a real date and time", path: ["sleepStart"] });
                if (!isRealLocalDateTime(values.sleepEnd))
                    ctx.addIssue({ code: "custom", message: "Enter a real date and time", path: ["sleepEnd"] });
                if (isRealLocalDateTime(values.sleepStart) && isRealLocalDateTime(values.sleepEnd)) {
                    const minutes = localMinutesBetween(values.sleepStart, values.sleepEnd);
                    if (minutes <= 0)
                        ctx.addIssue({ code: "custom", message: "Sleep must end after it starts", path: ["sleepEnd"] });
                    else if (minutes > MAX_SLEEP_MINUTES)
                        ctx.addIssue({
                            code: "custom",
                            message: "Sleep cannot span more than 24 hours",
                            path: ["sleepEnd"],
                        });
                }
                break;
            }
            case "daily_readiness": {
                const min = Number(values.scaleMin);
                const max = Number(values.scaleMax);
                const score = Number(values.score);
                if (!isInteger(values.scaleMin) || !isInteger(values.scaleMax) || max <= min)
                    ctx.addIssue({ code: "custom", message: "Scale maximum must exceed its minimum", path: ["score"] });
                else if (!isInteger(values.score) || score < min || score > max)
                    ctx.addIssue({
                        code: "custom",
                        message: `Enter a whole number between ${min} and ${max}`,
                        path: ["score"],
                    });
                break;
            }
        }
    });

export type HealthRecordFormValues = z.infer<typeof healthRecordFormSchema>;

export function healthRecordFormDefaults(record?: ManualHealthRecordResponse | null): HealthRecordFormValues {
    const body = record?.body;
    return {
        type: record?.type ?? "body_weight",
        effectiveAt: record && record.type !== "sleep" ? toLocalDateTime(record.effectiveAt) : "",
        timeZone: record?.timeZone ?? "",
        notes: record?.notes ?? "",
        massKg: body?.type === "body_weight" ? String(body.massKg) : "",
        beatsPerMinute: body?.type === "resting_heart_rate" ? String(body.beatsPerMinute) : "",
        sleepStart: body?.type === "sleep" ? toLocalDateTime(body.startAt) : "",
        sleepEnd: body?.type === "sleep" ? toLocalDateTime(body.endAt) : "",
        score: body?.type === "daily_readiness" ? String(body.score) : "",
        scaleMin: body?.type === "daily_readiness" ? String(body.scaleMin ?? 0) : "0",
        scaleMax: body?.type === "daily_readiness" ? String(body.scaleMax ?? 100) : "100",
    };
}

function bodyFrom(values: HealthRecordFormValues): HealthRecordBodyValue {
    switch (values.type) {
        case "body_weight":
            return { type: "body_weight", massKg: Number(values.massKg) };
        case "resting_heart_rate":
            return { type: "resting_heart_rate", beatsPerMinute: Number(values.beatsPerMinute) };
        case "sleep":
            return {
                type: "sleep",
                startAt: fromLocalDateTime(values.sleepStart),
                endAt: fromLocalDateTime(values.sleepEnd),
            };
        case "daily_readiness":
            return {
                type: "daily_readiness",
                score: Number(values.score),
                scaleMin: Number(values.scaleMin),
                scaleMax: Number(values.scaleMax),
            };
    }
}

function effectiveInstant(values: HealthRecordFormValues): string {
    return values.type === "sleep" ? fromLocalDateTime(values.sleepEnd) : fromLocalDateTime(values.effectiveAt);
}

export function healthRecordCreateInput(values: HealthRecordFormValues): CreateManualHealthRecordRequest {
    return {
        effectiveAt: effectiveInstant(values),
        ...(values.timeZone.trim() ? { timeZone: values.timeZone.trim() } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        body: bodyFrom(values),
    };
}

export function healthRecordUpdateInput(values: HealthRecordFormValues): UpdateManualHealthRecordRequest {
    return {
        effectiveAt: effectiveInstant(values),
        timeZone: values.timeZone.trim() ? values.timeZone.trim() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
        body: bodyFrom(values),
    };
}
