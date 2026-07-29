import { DomainValidationError } from "#src/platform/domain/index";

/**
 * WorkoutTemplate — a versioned, archivable revision root owning template metadata and a
 * pointer to its current immutable SessionPrescription tree (design 5.5, 10.3).
 *
 * The aggregate intentionally knows nothing about prescription structure: publishing and
 * validating the prescription tree stays in the SessionPrescription domain model. A
 * WorkoutTemplate only guards its own metadata, ownership, lifecycle status, and the
 * pointer to whichever immutable prescription is currently in force. Every edit hands the
 * aggregate a freshly published prescription ID; the pointer swap is the only mutation.
 */

export const workoutTemplateStatuses = ["active", "archived"] as const;

export type WorkoutTemplateStatus = (typeof workoutTemplateStatuses)[number];

export interface WorkoutTemplateState {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description: string | null;
    readonly currentPrescriptionId: string;
    readonly status: WorkoutTemplateStatus;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateWorkoutTemplateInput {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description?: string | null;
    readonly currentPrescriptionId: string;
}

export interface UpdateWorkoutTemplateInput {
    readonly name?: string;
    readonly description?: string | null;
    /** Present when an edit publishes a new prescription and advances the current pointer. */
    readonly currentPrescriptionId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkoutTemplate {
    private constructor(private current: WorkoutTemplateState) {}

    static create(input: CreateWorkoutTemplateInput, now: Date): WorkoutTemplate {
        const timestamp = isoTimestamp(now, "Workout template creation time");
        const state: WorkoutTemplateState = {
            id: requiredUuid(input.id, "Workout template ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            name: requiredText(input.name, "Name", 120),
            description: optionalText(input.description, "Description", 2_000),
            currentPrescriptionId: requiredUuid(input.currentPrescriptionId, "Current prescription ID"),
            status: "active",
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new WorkoutTemplate(immutableCopy(state));
    }

    static rehydrate(state: WorkoutTemplateState): WorkoutTemplate {
        const copied = immutableCopy(state);
        validateState(copied);
        return new WorkoutTemplate(copied);
    }

    get state(): WorkoutTemplateState {
        return immutableCopy(this.current);
    }

    update(input: UpdateWorkoutTemplateInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.name !== undefined ? { name: requiredText(input.name, "Name", 120) } : {}),
            ...(input.description !== undefined
                ? { description: optionalText(input.description, "Description", 2_000) }
                : {}),
            ...(input.currentPrescriptionId !== undefined
                ? { currentPrescriptionId: requiredUuid(input.currentPrescriptionId, "Current prescription ID") }
                : {}),
            updatedAt: isoTimestamp(now, "Workout template update time"),
        });
    }

    archive(now: Date): this {
        if (this.current.status === "archived") return this;
        return this.replace({
            ...this.current,
            status: "archived",
            archivedAt: isoTimestamp(now, "Workout template archive time"),
            updatedAt: isoTimestamp(now, "Workout template update time"),
        });
    }

    restore(now: Date): this {
        if (this.current.status === "active") return this;
        return this.replace({
            ...this.current,
            status: "active",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Workout template update time"),
        });
    }

    private replace(state: WorkoutTemplateState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: WorkoutTemplateState): void {
    requiredUuid(state.id, "Workout template ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredText(state.name, "Name", 120);
    optionalText(state.description, "Description", 2_000);
    requiredUuid(state.currentPrescriptionId, "Current prescription ID");
    normalizeStatus(state.status);
    if ((state.status === "archived") !== (state.archivedAt !== null))
        throw new DomainValidationError("Archived templates must carry an archive timestamp", {
            status: ["Archived templates must carry an archive timestamp"],
        });
    isoTimestamp(new Date(state.createdAt), "Workout template creation time");
    isoTimestamp(new Date(state.updatedAt), "Workout template update time");
}

function normalizeStatus(value: WorkoutTemplateStatus): WorkoutTemplateStatus {
    if (!workoutTemplateStatuses.includes(value))
        throw new DomainValidationError(`Unknown workout template status '${value}'`, {
            status: ["Unknown workout template status"],
        });
    return value;
}

function requiredText(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim().normalize("NFKC");
    if (normalized.length === 0 || normalized.length > maximumLength)
        throw new DomainValidationError(`${name} must be 1 to ${maximumLength} characters`, {
            name: [`${name} must be 1 to ${maximumLength} characters`],
        });
    return normalized;
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
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`, {
            description: [`${name} cannot exceed ${maximumLength} characters`],
        });
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
