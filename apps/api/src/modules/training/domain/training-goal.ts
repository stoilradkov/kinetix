import { DomainValidationError } from "#src/platform/domain/index";

export const goalTypes = ["strength", "endurance", "body_composition", "skill", "other"] as const;
export const goalStatuses = ["active", "achieved", "abandoned"] as const;

export type GoalType = (typeof goalTypes)[number];
export type GoalStatus = (typeof goalStatuses)[number];

export interface TrainingGoalState {
    readonly id: string;
    readonly profileId: string;
    readonly type: GoalType;
    readonly targetValue: string | null;
    readonly targetUnit: string | null;
    readonly startDate: string;
    readonly targetDate: string | null;
    readonly priority: number;
    readonly status: GoalStatus;
    readonly notes: string | null;
    readonly programId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateTrainingGoalInput {
    readonly id: string;
    readonly profileId: string;
    readonly type: GoalType;
    readonly targetValue?: string | null;
    readonly targetUnit?: string | null;
    readonly startDate?: string;
    readonly targetDate?: string | null;
    readonly priority?: number;
    readonly notes?: string | null;
    readonly programId?: string | null;
}

export interface UpdateTrainingGoalInput {
    readonly type?: GoalType;
    readonly targetValue?: string | null;
    readonly targetUnit?: string | null;
    readonly startDate?: string;
    readonly targetDate?: string | null;
    readonly priority?: number;
    readonly status?: GoalStatus;
    readonly notes?: string | null;
    readonly programId?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,3})?$/;

export class TrainingGoal {
    private constructor(private current: TrainingGoalState) {}

    static create(input: CreateTrainingGoalInput, now: Date): TrainingGoal {
        const timestamp = isoTimestamp(now, "Training goal creation time");
        const state: TrainingGoalState = {
            id: requiredUuid(input.id, "Training goal ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            type: normalizeType(input.type),
            targetValue: normalizeDecimal(input.targetValue, "Target value"),
            targetUnit: normalizeUnit(input.targetUnit),
            startDate: normalizeDate(input.startDate ?? now.toISOString().slice(0, 10), "Start date"),
            targetDate: input.targetDate == null ? null : normalizeDate(input.targetDate, "Target date"),
            priority: priority(input.priority ?? 1),
            status: "active",
            notes: optionalText(input.notes, "Notes", 2_000),
            programId: input.programId == null ? null : requiredUuid(input.programId, "Program ID"),
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new TrainingGoal(immutableCopy(state));
    }

    static rehydrate(state: TrainingGoalState): TrainingGoal {
        const copied = immutableCopy(state);
        validateState(copied);
        return new TrainingGoal(copied);
    }

    get state(): TrainingGoalState {
        return immutableCopy(this.current);
    }

    update(input: UpdateTrainingGoalInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.type !== undefined ? { type: normalizeType(input.type) } : {}),
            ...(input.targetValue !== undefined
                ? { targetValue: normalizeDecimal(input.targetValue, "Target value") }
                : {}),
            ...(input.targetUnit !== undefined ? { targetUnit: normalizeUnit(input.targetUnit) } : {}),
            ...(input.startDate !== undefined ? { startDate: normalizeDate(input.startDate, "Start date") } : {}),
            ...(input.targetDate !== undefined
                ? { targetDate: input.targetDate === null ? null : normalizeDate(input.targetDate, "Target date") }
                : {}),
            ...(input.priority !== undefined ? { priority: priority(input.priority) } : {}),
            ...(input.status !== undefined ? { status: normalizeStatus(input.status) } : {}),
            ...(input.notes !== undefined ? { notes: optionalText(input.notes, "Notes", 2_000) } : {}),
            ...(input.programId !== undefined
                ? { programId: input.programId === null ? null : requiredUuid(input.programId, "Program ID") }
                : {}),
            updatedAt: isoTimestamp(now, "Training goal update time"),
        });
    }

    private replace(state: TrainingGoalState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: TrainingGoalState): void {
    requiredUuid(state.id, "Training goal ID");
    requiredUuid(state.profileId, "Profile ID");
    normalizeType(state.type);
    normalizeStatus(state.status);
    if (state.targetValue !== null) normalizeDecimal(state.targetValue, "Target value");
    if (state.targetUnit !== null) normalizeUnit(state.targetUnit);
    if ((state.targetValue === null) !== (state.targetUnit === null))
        throw new DomainValidationError("Target value and unit must be set together", {
            targetValue: ["Provide both a target value and a unit, or neither"],
        });
    normalizeDate(state.startDate, "Start date");
    if (state.targetDate !== null) {
        normalizeDate(state.targetDate, "Target date");
        if (state.targetDate < state.startDate)
            throw new DomainValidationError("Target date cannot be before the start date", {
                targetDate: ["Target date cannot be before the start date"],
            });
    }
    priority(state.priority);
    if (state.programId !== null) requiredUuid(state.programId, "Program ID");
    optionalText(state.notes, "Notes", 2_000);
    isoTimestamp(new Date(state.createdAt), "Training goal creation time");
    isoTimestamp(new Date(state.updatedAt), "Training goal update time");
}

function normalizeType(value: GoalType): GoalType {
    if (!goalTypes.includes(value))
        throw new DomainValidationError(`Unknown goal type '${value}'`, { type: ["Unknown goal type"] });
    return value;
}

function normalizeStatus(value: GoalStatus): GoalStatus {
    if (!goalStatuses.includes(value))
        throw new DomainValidationError(`Unknown goal status '${value}'`, { status: ["Unknown goal status"] });
    return value;
}

function normalizeDecimal(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!DECIMAL_PATTERN.test(normalized))
        throw new DomainValidationError(`${name} must be a non-negative number with up to three decimals`, {
            targetValue: ["Enter a non-negative number"],
        });
    return normalized;
}

function normalizeUnit(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 40)
        throw new DomainValidationError("Target unit must be 1 to 40 characters", {
            targetUnit: ["Enter a unit of 1 to 40 characters"],
        });
    return normalized;
}

function normalizeDate(value: string, name: string): string {
    const normalized = value.trim();
    if (!ISO_DATE_PATTERN.test(normalized))
        throw new DomainValidationError(`${name} must be an ISO calendar date (YYYY-MM-DD)`);
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized)
        throw new DomainValidationError(`${name} '${normalized}' is not a real calendar date`);
    return normalized;
}

function priority(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000)
        throw new DomainValidationError("Priority must be an integer between 1 and 1000", {
            priority: ["Enter a whole number between 1 and 1000"],
        });
    return value;
}

function requiredUuid(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) throw new DomainValidationError(`${name} must be a UUID`);
    return normalized;
}

function optionalText(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value == null) return null;
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0) return null;
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
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
