import { DomainValidationError } from "#src/platform/domain/index";

export const trainingExperiences = ["beginner", "intermediate", "advanced"] as const;
export const trainingProfileStatuses = ["active", "archived"] as const;

export type TrainingExperience = (typeof trainingExperiences)[number];
export type TrainingProfileStatus = (typeof trainingProfileStatuses)[number];

export interface TrainingProfileState {
    readonly id: string;
    readonly profileId: string;
    readonly status: TrainingProfileStatus;
    readonly experience: TrainingExperience;
    /** Sets with at most this many work reps are eligible for 1RM estimation (design 16.5). */
    readonly oneRepMaxRepCutoff: number;
    /** A non-warm-up set counts as "hard" at or above this RPE (design 16.4). */
    readonly hardSetRpeThreshold: number;
    /** …or at or below this RIR. */
    readonly hardSetRirThreshold: number;
    readonly calculatorVersion: number;
    readonly ruleVersion: number;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateTrainingProfileInput {
    readonly id: string;
    readonly profileId: string;
    readonly experience?: TrainingExperience;
    readonly oneRepMaxRepCutoff?: number;
    readonly hardSetRpeThreshold?: number;
    readonly hardSetRirThreshold?: number;
    readonly calculatorVersion?: number;
    readonly ruleVersion?: number;
}

export interface UpdateTrainingProfileInput {
    readonly experience?: TrainingExperience;
    readonly oneRepMaxRepCutoff?: number;
    readonly hardSetRpeThreshold?: number;
    readonly hardSetRirThreshold?: number;
    readonly calculatorVersion?: number;
    readonly ruleVersion?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULTS = {
    experience: "beginner" as TrainingExperience,
    oneRepMaxRepCutoff: 12,
    hardSetRpeThreshold: 7,
    hardSetRirThreshold: 3,
    calculatorVersion: 1,
    ruleVersion: 1,
};

export class TrainingProfile {
    private constructor(private current: TrainingProfileState) {}

    static create(input: CreateTrainingProfileInput, now: Date): TrainingProfile {
        const timestamp = isoTimestamp(now, "Training profile creation time");
        const state: TrainingProfileState = {
            id: requiredUuid(input.id, "Training profile ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            status: "active",
            experience: normalizeExperience(input.experience ?? DEFAULTS.experience),
            oneRepMaxRepCutoff: repCutoff(input.oneRepMaxRepCutoff ?? DEFAULTS.oneRepMaxRepCutoff),
            hardSetRpeThreshold: rpe(input.hardSetRpeThreshold ?? DEFAULTS.hardSetRpeThreshold),
            hardSetRirThreshold: rir(input.hardSetRirThreshold ?? DEFAULTS.hardSetRirThreshold),
            calculatorVersion: positiveVersion(
                input.calculatorVersion ?? DEFAULTS.calculatorVersion,
                "Calculator version",
            ),
            ruleVersion: positiveVersion(input.ruleVersion ?? DEFAULTS.ruleVersion, "Rule version"),
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new TrainingProfile(immutableCopy(state));
    }

    static rehydrate(state: TrainingProfileState): TrainingProfile {
        const copied = immutableCopy(state);
        validateState(copied);
        return new TrainingProfile(copied);
    }

    get state(): TrainingProfileState {
        return immutableCopy(this.current);
    }

    update(input: UpdateTrainingProfileInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.experience !== undefined ? { experience: normalizeExperience(input.experience) } : {}),
            ...(input.oneRepMaxRepCutoff !== undefined
                ? { oneRepMaxRepCutoff: repCutoff(input.oneRepMaxRepCutoff) }
                : {}),
            ...(input.hardSetRpeThreshold !== undefined ? { hardSetRpeThreshold: rpe(input.hardSetRpeThreshold) } : {}),
            ...(input.hardSetRirThreshold !== undefined ? { hardSetRirThreshold: rir(input.hardSetRirThreshold) } : {}),
            ...(input.calculatorVersion !== undefined
                ? { calculatorVersion: positiveVersion(input.calculatorVersion, "Calculator version") }
                : {}),
            ...(input.ruleVersion !== undefined
                ? { ruleVersion: positiveVersion(input.ruleVersion, "Rule version") }
                : {}),
            updatedAt: isoTimestamp(now, "Training profile update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.status === "archived") throw new DomainValidationError("Training profile is already archived");
        const timestamp = isoTimestamp(now, "Training profile archive time");
        return this.replace({ ...this.current, status: "archived", archivedAt: timestamp, updatedAt: timestamp });
    }

    restore(now: Date): this {
        if (this.current.status === "active") throw new DomainValidationError("Training profile is already active");
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Training profile restore time"),
        });
    }

    private replace(state: TrainingProfileState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: TrainingProfileState): void {
    requiredUuid(state.id, "Training profile ID");
    requiredUuid(state.profileId, "Profile ID");
    if (!trainingProfileStatuses.includes(state.status))
        throw new DomainValidationError(`Unknown training profile status '${state.status}'`);
    normalizeExperience(state.experience);
    repCutoff(state.oneRepMaxRepCutoff);
    rpe(state.hardSetRpeThreshold);
    rir(state.hardSetRirThreshold);
    positiveVersion(state.calculatorVersion, "Calculator version");
    positiveVersion(state.ruleVersion, "Rule version");
    isoTimestamp(new Date(state.createdAt), "Training profile creation time");
    isoTimestamp(new Date(state.updatedAt), "Training profile update time");
    if ((state.status === "active") !== (state.archivedAt === null))
        throw new DomainValidationError("Training profile archive state is inconsistent");
    if (state.archivedAt !== null) isoTimestamp(new Date(state.archivedAt), "Training profile archive time");
}

function normalizeExperience(value: TrainingExperience): TrainingExperience {
    if (!trainingExperiences.includes(value))
        throw new DomainValidationError(`Unknown training experience '${value}'`, {
            experience: ["Unknown experience"],
        });
    return value;
}

function repCutoff(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 20)
        throw new DomainValidationError("1RM repetition cutoff must be an integer between 1 and 20", {
            oneRepMaxRepCutoff: ["Enter a whole number between 1 and 20"],
        });
    return value;
}

function rpe(value: number): number {
    if (!Number.isFinite(value) || value < 0 || value > 10 || Math.round(value * 2) !== value * 2)
        throw new DomainValidationError("Hard-set RPE threshold must be between 0 and 10 in 0.5 steps", {
            hardSetRpeThreshold: ["Enter a value between 0 and 10 in 0.5 steps"],
        });
    return value;
}

function rir(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10)
        throw new DomainValidationError("Hard-set RIR threshold must be an integer between 0 and 10", {
            hardSetRirThreshold: ["Enter a whole number between 0 and 10"],
        });
    return value;
}

function positiveVersion(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new DomainValidationError(`${name} must be a positive integer`);
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function isoTimestamp(value: Date, name: string): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return value.toISOString();
}

function immutableCopy<Value>(value: Value): Value {
    return structuredClone(value);
}
