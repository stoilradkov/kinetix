import type { SnapshotCellValue } from "#src/model";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function excelSerialToIsoDate(serial: number): string | null {
    if (!Number.isFinite(serial) || serial < 1 || serial > 100_000) return null;
    return new Date(EXCEL_EPOCH_MS + Math.trunc(serial) * DAY_MS).toISOString().slice(0, 10);
}

export function parseSourceDate(value: SnapshotCellValue): { localDate: string | null; error: string | null } {
    if (typeof value === "number") {
        const localDate = excelSerialToIsoDate(value);
        return localDate
            ? { localDate, error: null }
            : { localDate: null, error: `Invalid Excel date serial: ${value}` };
    }

    if (typeof value !== "string" || value.trim() === "") return { localDate: null, error: "Missing date" };
    const raw = value.trim();

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (iso) return validateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]), raw);

    const european = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw);
    if (european) {
        let year = Number(european[3]);
        if (year >= 0 && year < 100) year += year >= 70 ? 1900 : 2000;
        return validateParts(year, Number(european[2]), Number(european[1]), raw);
    }

    return { localDate: null, error: `Unrecognized date: ${raw}` };
}

function validateParts(
    year: number,
    month: number,
    day: number,
    raw: string,
): { localDate: string | null; error: string | null } {
    if (year < 2000 || year > 2100) return { localDate: null, error: `Suspicious year in date: ${raw}` };
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
        return { localDate: null, error: `Invalid calendar date: ${raw}` };
    return { localDate: date.toISOString().slice(0, 10), error: null };
}

export function recoverRepTarget(value: SnapshotCellValue): SnapshotCellValue {
    if (typeof value !== "number" || value < 40_000) return value;
    const date = new Date(EXCEL_EPOCH_MS + Math.trunc(value) * DAY_MS);
    return `${date.getUTCDate()}-${date.getUTCMonth() + 1}`;
}
