/**
 * Estimated one-rep-max formulas and the primary median estimate (issue #45, A3; design §16.5; PRD AN-3).
 *
 * These are pure, deterministic functions of a set's load and repetition count. Kinetix retains the output
 * of six published formulas — Epley, Brzycki, Lombardi, Mayhew, O'Conner, and Wathan — because they disagree
 * and each has a limited eligibility window; the versioned primary estimate is the median of the valid
 * formula results so no single formula is trusted as authoritative. The exact algebra is pinned by golden
 * vectors (design §21), and every value is rounded to a canonical 0.01 kg so a projection fingerprint is
 * stable across recomputes. No repositories, jobs, persistence, or wire schemas live here.
 */

/** The six retained estimated-1RM formulas (design §16.5; PRD AN-3). Each is versioned with the calculator. */
export type OneRmFormula = "epley" | "brzycki" | "lombardi" | "mayhew" | "oconner" | "wathan";

export const ONE_RM_FORMULAS: readonly OneRmFormula[] = ["epley", "brzycki", "lombardi", "mayhew", "oconner", "wathan"];

/** Stable calculator keys — one per retained formula plus the composite primary (design §16.5). */
export const ESTIMATED_1RM_EPLEY = "estimated_1rm.epley";
export const ESTIMATED_1RM_BRZYCKI = "estimated_1rm.brzycki";
export const ESTIMATED_1RM_LOMBARDI = "estimated_1rm.lombardi";
export const ESTIMATED_1RM_MAYHEW = "estimated_1rm.mayhew";
export const ESTIMATED_1RM_OCONNER = "estimated_1rm.oconner";
export const ESTIMATED_1RM_WATHAN = "estimated_1rm.wathan";
export const ESTIMATED_1RM_PRIMARY = "estimated_1rm.primary";

/** The calculator key that retains a given formula's output. */
export function estimated1RMFormulaKey(formula: OneRmFormula): string {
    return `estimated_1rm.${formula}`;
}

/** Default 1RM eligibility repetition window when a profile omits an override (design §16.5). */
export const ESTIMATED_1RM_DEFAULT_REP_MIN = 1;
export const ESTIMATED_1RM_DEFAULT_REP_CUTOFF = 12;

const ROUND_SCALE = 100; // canonical 0.01 kg precision — folds into the projection fingerprint

/**
 * The raw (unrounded) estimated 1RM for one formula, given the effective load in kilograms and the number
 * of repetitions performed. The formulas are defined for `reps ≥ 1`; Brzycki has a singularity at 37 reps,
 * which the 1–12 eligibility window (design §16.5) keeps well away. Callers apply eligibility before this.
 */
export function estimate1RMRaw(loadKg: number, reps: number, formula: OneRmFormula): number {
    switch (formula) {
        case "epley":
            return loadKg * (1 + reps / 30);
        case "brzycki":
            return (loadKg * 36) / (37 - reps);
        case "lombardi":
            return loadKg * Math.pow(reps, 0.1);
        case "mayhew":
            return (100 * loadKg) / (52.2 + 41.9 * Math.exp(-0.055 * reps));
        case "oconner":
            return loadKg * (1 + 0.025 * reps);
        case "wathan":
            return (100 * loadKg) / (48.8 + 53.8 * Math.exp(-0.075 * reps));
    }
}

/** A formula's estimated 1RM rounded to the canonical 0.01 kg, or null when the inputs are not finite. */
export function estimate1RM(loadKg: number, reps: number, formula: OneRmFormula): number | null {
    if (!Number.isFinite(loadKg) || loadKg <= 0 || !Number.isFinite(reps) || reps < 1) return null;
    const raw = estimate1RMRaw(loadKg, reps, formula);
    return Number.isFinite(raw) ? roundKg(raw) : null;
}

/** Round a kilogram value to the canonical 0.01 kg used for every stored 1RM estimate. */
export function roundKg(value: number): number {
    return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

/** Every formula's rounded estimate for one set (undefined entries are omitted — all six are defined 1–12). */
export type FormulaEstimates = Partial<Record<OneRmFormula, number>>;

/** One set's estimated-1RM reading: each formula's value and the primary median over the valid results. */
export interface OneRmEstimate {
    readonly loadKg: number;
    readonly reps: number;
    readonly formulas: FormulaEstimates;
    /** Median of the valid formula results (design §16.5), rounded to 0.01 kg, or null when none are valid. */
    readonly primary: number | null;
}

/** Compute every formula and the primary median estimate for one eligible set's load and repetitions. */
export function oneRmEstimate(loadKg: number, reps: number): OneRmEstimate {
    const formulas: FormulaEstimates = {};
    const values: number[] = [];
    for (const formula of ONE_RM_FORMULAS) {
        const value = estimate1RM(loadKg, reps, formula);
        if (value === null) continue;
        formulas[formula] = value;
        values.push(value);
    }
    const middle = median(values);
    return { loadKg, reps, formulas, primary: middle === null ? null : roundKg(middle) };
}

/**
 * The median of a set of numbers (design §16.5 primary selection): the middle value for an odd count, and
 * the mean of the two central values for an even count. Non-finite inputs are ignored; an empty input is
 * null. The result is intentionally left unrounded so the caller pins it to the canonical precision.
 */
export function median(values: readonly number[]): number | null {
    const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    const upper = sorted[mid] as number;
    return sorted.length % 2 === 1 ? upper : (upper + (sorted[mid - 1] as number)) / 2;
}

/** Whether a repetition count falls within the (versioned) 1RM eligibility window `[repMin, repCutoff]`. */
export function is1RMEligibleReps(reps: number, repMin: number, repCutoff: number): boolean {
    return Number.isInteger(reps) && reps >= repMin && reps <= repCutoff;
}
