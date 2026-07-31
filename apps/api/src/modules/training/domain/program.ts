import { DomainValidationError } from "#src/platform/domain/index";

/**
 * Program — a versioned, archivable revision root owning program metadata plus its nested block
 * tree (design 5.6, 10.3). Planned sessions are separate aggregates linked through join rows, so
 * the Program aggregate guards only its own lifecycle, schedule mode, goal links, and block tree.
 *
 * Blocks form an acyclic tree scoped to a single program. Overlapping date/relative ranges are
 * NOT rejected here — they surface as planning warnings (see {@link ./program-planning}). The
 * aggregate rejects only structurally invalid trees (cycles, cross-scope parents, duplicate
 * sibling positions, inverted ranges).
 */

export const programStatuses = ["draft", "active", "paused", "completed", "archived"] as const;
export type ProgramStatus = (typeof programStatuses)[number];

export const programScheduleModes = ["relative", "dated", "ordered"] as const;
export type ProgramScheduleMode = (typeof programScheduleModes)[number];

export const programBlockTypes = ["macrocycle", "mesocycle", "microcycle", "custom"] as const;
export type ProgramBlockType = (typeof programBlockTypes)[number];

export interface ProgramBlockState {
    readonly id: string;
    readonly parentBlockId: string | null;
    readonly type: ProgramBlockType;
    readonly label: string | null;
    readonly position: number;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly relativeStartWeek: number | null;
    readonly relativeEndWeek: number | null;
    readonly focus: string | null;
    readonly targetMuscles: readonly string[];
    readonly targetVolume: string | null;
    readonly targetIntensity: string | null;
    readonly deload: boolean;
    readonly expectedAdaptations: string | null;
    readonly notes: string | null;
    readonly tags: readonly string[];
}

export interface ProgramBlockInput {
    readonly id: string;
    readonly parentBlockId?: string | null;
    readonly type: ProgramBlockType;
    readonly label?: string | null;
    readonly position: number;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
    readonly relativeStartWeek?: number | null;
    readonly relativeEndWeek?: number | null;
    readonly focus?: string | null;
    readonly targetMuscles?: readonly string[];
    readonly targetVolume?: string | null;
    readonly targetIntensity?: string | null;
    readonly deload?: boolean;
    readonly expectedAdaptations?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
}

export interface ProgramState {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: ProgramStatus;
    readonly scheduleMode: ProgramScheduleMode;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly focus: string | null;
    readonly blocks: readonly ProgramBlockState[];
    readonly goalIds: readonly string[];
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CreateProgramInput {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly description?: string | null;
    readonly scheduleMode?: ProgramScheduleMode;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
    readonly focus?: string | null;
    readonly blocks?: readonly ProgramBlockInput[];
    readonly goalIds?: readonly string[];
}

export interface UpdateProgramInput {
    readonly name?: string;
    readonly description?: string | null;
    readonly scheduleMode?: ProgramScheduleMode;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
    readonly focus?: string | null;
    readonly blocks?: readonly ProgramBlockInput[];
    readonly goalIds?: readonly string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Allowed lifecycle transitions (design 5.6, PR-1). Restore returns an archived program to draft. */
const ALLOWED_TRANSITIONS: Readonly<Record<ProgramStatus, readonly ProgramStatus[]>> = {
    draft: ["active", "archived"],
    active: ["paused", "completed", "archived"],
    paused: ["active", "completed", "archived"],
    completed: ["archived"],
    archived: ["draft"],
};

export class Program {
    private constructor(private current: ProgramState) {}

    static create(input: CreateProgramInput, now: Date): Program {
        const timestamp = isoTimestamp(now, "Program creation time");
        const state: ProgramState = {
            id: requiredUuid(input.id, "Program ID"),
            profileId: requiredUuid(input.profileId, "Profile ID"),
            name: requiredText(input.name, "Name", 160),
            description: optionalText(input.description, "Description", 4_000),
            status: "draft",
            scheduleMode: normalizeScheduleMode(input.scheduleMode ?? "ordered"),
            startDate: optionalLocalDate(input.startDate, "Start date"),
            endDate: optionalLocalDate(input.endDate, "End date"),
            focus: optionalText(input.focus, "Focus", 500),
            blocks: normalizeBlocks(input.blocks ?? []),
            goalIds: normalizeGoalIds(input.goalIds ?? []),
            archivedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        validateState(state);
        return new Program(immutableCopy(state));
    }

    static rehydrate(state: ProgramState): Program {
        const copied = immutableCopy(state);
        validateState(copied);
        return new Program(copied);
    }

    get state(): ProgramState {
        return immutableCopy(this.current);
    }

    update(input: UpdateProgramInput, now: Date): this {
        return this.replace({
            ...this.current,
            ...(input.name !== undefined ? { name: requiredText(input.name, "Name", 160) } : {}),
            ...(input.description !== undefined
                ? { description: optionalText(input.description, "Description", 4_000) }
                : {}),
            ...(input.scheduleMode !== undefined ? { scheduleMode: normalizeScheduleMode(input.scheduleMode) } : {}),
            ...(input.startDate !== undefined ? { startDate: optionalLocalDate(input.startDate, "Start date") } : {}),
            ...(input.endDate !== undefined ? { endDate: optionalLocalDate(input.endDate, "End date") } : {}),
            ...(input.focus !== undefined ? { focus: optionalText(input.focus, "Focus", 500) } : {}),
            ...(input.blocks !== undefined ? { blocks: normalizeBlocks(input.blocks) } : {}),
            ...(input.goalIds !== undefined ? { goalIds: normalizeGoalIds(input.goalIds) } : {}),
            updatedAt: isoTimestamp(now, "Program update time"),
        });
    }

    activate(now: Date): this {
        return this.transitionTo("active", now);
    }

    pause(now: Date): this {
        return this.transitionTo("paused", now);
    }

    resume(now: Date): this {
        return this.transitionTo("active", now);
    }

    complete(now: Date): this {
        return this.transitionTo("completed", now);
    }

    archive(now: Date): this {
        if (this.current.status === "archived") return this;
        const timestamp = isoTimestamp(now, "Program update time");
        return this.replace({
            ...this.current,
            status: "archived",
            archivedAt: timestamp,
            updatedAt: timestamp,
        });
    }

    restore(now: Date): this {
        if (this.current.status !== "archived") return this;
        return this.replace({
            ...this.current,
            status: "draft",
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Program update time"),
        });
    }

    private transitionTo(target: ProgramStatus, now: Date): this {
        if (this.current.status === target) return this;
        if (!ALLOWED_TRANSITIONS[this.current.status].includes(target))
            throw new DomainValidationError(`Cannot move a ${this.current.status} program to ${target}`, {
                status: [`Cannot move a ${this.current.status} program to ${target}`],
            });
        return this.replace({
            ...this.current,
            status: target,
            archivedAt: null,
            updatedAt: isoTimestamp(now, "Program update time"),
        });
    }

    private replace(state: ProgramState): this {
        validateState(state);
        this.current = immutableCopy(state);
        return this;
    }
}

function validateState(state: ProgramState): void {
    requiredUuid(state.id, "Program ID");
    requiredUuid(state.profileId, "Profile ID");
    requiredText(state.name, "Name", 160);
    optionalText(state.description, "Description", 4_000);
    normalizeStatus(state.status);
    normalizeScheduleMode(state.scheduleMode);
    validateDateRange(state.startDate, state.endDate);
    normalizeGoalIds(state.goalIds);
    validateBlockTree(state.blocks);
    if ((state.status === "archived") !== (state.archivedAt !== null))
        throw new DomainValidationError("Archived programs must carry an archive timestamp", {
            status: ["Archived programs must carry an archive timestamp"],
        });
    isoTimestamp(new Date(state.createdAt), "Program creation time");
    isoTimestamp(new Date(state.updatedAt), "Program update time");
}

function normalizeBlocks(blocks: readonly ProgramBlockInput[]): readonly ProgramBlockState[] {
    const normalized = blocks.map(normalizeBlock);
    validateBlockTree(normalized);
    return normalized;
}

function normalizeBlock(input: ProgramBlockInput): ProgramBlockState {
    const type = normalizeBlockType(input.type);
    const label = optionalText(input.label, "Block label", 160);
    if (type === "custom" && label === null)
        throw new DomainValidationError("Custom blocks require a label", { label: ["Custom blocks require a label"] });
    if (!Number.isInteger(input.position) || input.position < 0)
        throw new DomainValidationError("Block position must be a non-negative integer", {
            position: ["Block position must be a non-negative integer"],
        });
    return {
        id: requiredUuid(input.id, "Block ID"),
        parentBlockId: input.parentBlockId == null ? null : requiredUuid(input.parentBlockId, "Parent block ID"),
        type,
        label,
        position: input.position,
        startDate: optionalLocalDate(input.startDate, "Block start date"),
        endDate: optionalLocalDate(input.endDate, "Block end date"),
        relativeStartWeek: optionalInteger(input.relativeStartWeek, "Block relative start week"),
        relativeEndWeek: optionalInteger(input.relativeEndWeek, "Block relative end week"),
        focus: optionalText(input.focus, "Block focus", 500),
        targetMuscles: normalizeSlugList(input.targetMuscles ?? [], "Target muscle"),
        targetVolume: optionalText(input.targetVolume, "Target volume", 120),
        targetIntensity: optionalText(input.targetIntensity, "Target intensity", 120),
        deload: input.deload ?? false,
        expectedAdaptations: optionalText(input.expectedAdaptations, "Expected adaptations", 2_000),
        notes: optionalText(input.notes, "Block notes", 2_000),
        tags: normalizeSlugList(input.tags ?? [], "Tag"),
    };
}

function validateBlockTree(blocks: readonly ProgramBlockState[]): void {
    const byId = new Map<string, ProgramBlockState>();
    for (const block of blocks) {
        if (byId.has(block.id))
            throw new DomainValidationError(`Duplicate block ID ${block.id}`, { blocks: ["Duplicate block ID"] });
        byId.set(block.id, block);
    }
    const positions = new Map<string, Set<number>>();
    for (const block of blocks) {
        validateDateRange(block.startDate, block.endDate, "Block start date must not be after block end date");
        validateRelativeRange(block.relativeStartWeek, block.relativeEndWeek);
        if (block.parentBlockId !== null && !byId.has(block.parentBlockId))
            throw new DomainValidationError("Block parent must belong to the same program", {
                blocks: ["Block parent must belong to the same program"],
            });
        const scope = block.parentBlockId ?? "__root__";
        const used = positions.get(scope) ?? new Set<number>();
        if (used.has(block.position))
            throw new DomainValidationError("Sibling blocks must have unique positions", {
                blocks: ["Sibling blocks must have unique positions"],
            });
        used.add(block.position);
        positions.set(scope, used);
    }
    for (const block of blocks) assertNoCycle(block, byId);
}

function assertNoCycle(block: ProgramBlockState, byId: Map<string, ProgramBlockState>): void {
    const seen = new Set<string>([block.id]);
    let cursor = block.parentBlockId;
    while (cursor !== null) {
        if (seen.has(cursor))
            throw new DomainValidationError("Block hierarchy must be acyclic", {
                blocks: ["Block hierarchy must be acyclic"],
            });
        seen.add(cursor);
        const parent = byId.get(cursor);
        if (!parent) return;
        cursor = parent.parentBlockId;
    }
}

function validateDateRange(startDate: string | null, endDate: string | null, message?: string): void {
    if (startDate !== null && endDate !== null && startDate > endDate)
        throw new DomainValidationError(message ?? "Start date must not be after end date", {
            endDate: [message ?? "Start date must not be after end date"],
        });
}

function validateRelativeRange(start: number | null, end: number | null): void {
    if (start !== null && end !== null && start > end)
        throw new DomainValidationError("Relative start week must not be after relative end week", {
            relativeEndWeek: ["Relative start week must not be after relative end week"],
        });
}

function normalizeStatus(value: ProgramStatus): ProgramStatus {
    if (!programStatuses.includes(value))
        throw new DomainValidationError(`Unknown program status '${value}'`, {
            status: ["Unknown program status"],
        });
    return value;
}

function normalizeScheduleMode(value: ProgramScheduleMode): ProgramScheduleMode {
    if (!programScheduleModes.includes(value))
        throw new DomainValidationError(`Unknown schedule mode '${value}'`, {
            scheduleMode: ["Unknown schedule mode"],
        });
    return value;
}

function normalizeBlockType(value: ProgramBlockType): ProgramBlockType {
    if (!programBlockTypes.includes(value))
        throw new DomainValidationError(`Unknown block type '${value}'`, { type: ["Unknown block type"] });
    return value;
}

function normalizeGoalIds(goalIds: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const goalId of goalIds) {
        const normalized = requiredUuid(goalId, "Goal ID");
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function normalizeSlugList(values: readonly string[], name: string): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim().normalize("NFKC");
        if (normalized.length === 0 || normalized.length > 80)
            throw new DomainValidationError(`${name} must be 1 to 80 characters`, {
                tags: [`${name} must be 1 to 80 characters`],
            });
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
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
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optionalInteger(value: number | null | undefined, name: string): number | null {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0)
        throw new DomainValidationError(`${name} must be a non-negative integer`);
    return value;
}

function optionalLocalDate(value: string | null | undefined, name: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (normalized.length === 0) return null;
    if (!LOCAL_DATE_PATTERN.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime()))
        throw new DomainValidationError(`${name} must be a valid YYYY-MM-DD date`);
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
