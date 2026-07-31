import type { ProgramBlockState, ProgramState } from "#src/modules/training/domain/program";

/**
 * Program planning policy (design 5.6, PR-2/PR-3). Overlapping blocks and schedule collisions are
 * intentionally NOT domain errors — the aggregate accepts them and this pure policy surfaces them
 * as structured warnings with evidence. Presentation/dry-run renders them; SQL never hides them.
 */

export const planningWarningCodes = ["block_overlap", "schedule_collision"] as const;
export type PlanningWarningCode = (typeof planningWarningCodes)[number];

export interface PlanningWarning {
    readonly code: PlanningWarningCode;
    readonly message: string;
    readonly evidence: Readonly<Record<string, unknown>>;
}

/** Minimal schedule descriptor for a planned session, used to detect calendar collisions. */
export interface PlannedSessionSchedule {
    readonly id: string;
    readonly localDate: string | null;
    readonly preferredTime: string | null;
}

export function evaluateProgramWarnings(
    program: ProgramState,
    sessions: readonly PlannedSessionSchedule[] = [],
): readonly PlanningWarning[] {
    return [...blockOverlapWarnings(program.blocks), ...scheduleCollisionWarnings(sessions)];
}

function blockOverlapWarnings(blocks: readonly ProgramBlockState[]): PlanningWarning[] {
    const warnings: PlanningWarning[] = [];
    const bySibling = new Map<string, ProgramBlockState[]>();
    for (const block of blocks) {
        const scope = block.parentBlockId ?? "__root__";
        (bySibling.get(scope) ?? bySibling.set(scope, []).get(scope)!).push(block);
    }
    for (const siblings of bySibling.values()) {
        for (let i = 0; i < siblings.length; i += 1)
            for (let j = i + 1; j < siblings.length; j += 1) {
                const [a, b] = [siblings[i]!, siblings[j]!];
                if (blocksOverlap(a, b))
                    warnings.push({
                        code: "block_overlap",
                        message: `Blocks ${describeBlock(a)} and ${describeBlock(b)} overlap`,
                        evidence: { blockIds: [a.id, b.id], parentBlockId: a.parentBlockId },
                    });
            }
    }
    return warnings;
}

function blocksOverlap(a: ProgramBlockState, b: ProgramBlockState): boolean {
    return (
        rangesOverlap(a.startDate, a.endDate, b.startDate, b.endDate) ||
        rangesOverlap(a.relativeStartWeek, a.relativeEndWeek, b.relativeStartWeek, b.relativeEndWeek)
    );
}

function rangesOverlap<T extends string | number>(
    aStart: T | null,
    aEnd: T | null,
    bStart: T | null,
    bEnd: T | null,
): boolean {
    if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
    return aStart <= bEnd && bStart <= aEnd;
}

function scheduleCollisionWarnings(sessions: readonly PlannedSessionSchedule[]): PlanningWarning[] {
    const warnings: PlanningWarning[] = [];
    const bySlot = new Map<string, string[]>();
    for (const session of sessions) {
        if (session.localDate === null) continue;
        const slot = `${session.localDate}T${session.preferredTime ?? "*"}`;
        (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push(session.id);
    }
    for (const [slot, ids] of bySlot)
        if (ids.length > 1)
            warnings.push({
                code: "schedule_collision",
                message: `${ids.length} planned sessions share ${slot}`,
                evidence: { slot, plannedSessionIds: ids },
            });
    return warnings;
}

function describeBlock(block: ProgramBlockState): string {
    return block.label ?? block.type;
}
