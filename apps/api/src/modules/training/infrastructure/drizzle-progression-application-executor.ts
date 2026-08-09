import { Inject, Injectable } from "@nestjs/common";

import type { CommandContext } from "#src/platform/application/index";

import {
    draftFromState,
    type RuleScope,
    type RuleTarget,
    type SessionPrescriptionState,
} from "#src/modules/training/domain/index";
import {
    ProgressionNotApplicableError,
    WORKOUT_TEMPLATE_COMMANDS,
    WORKOUT_TEMPLATE_PLANNING_READER,
    type ProgressionApplicationExecutor,
    type ProgressionResultRevisionView,
    type ResolvedProgressionTarget,
    type WorkoutTemplateCommands,
    type WorkoutTemplatePlanningReader,
} from "#src/modules/training/application/index";

/**
 * Applies an approved progression proposal to its target owner root (design §15.3, PRD PG-7). The MVP
 * supports `mode: "template"` targets: it resolves the rule's scoped {@link WorkoutTemplate}, and applies
 * the transformed prescription by republishing it through the template's own command so the template
 * advances a revision, records history, and links the new version→prescription — never mutating an
 * immutable prescription row. Planned-session targets (`next`, `block_future`) are not yet appliable
 * and are refused with an actionable error rather than applied partially.
 */
@Injectable()
export class DrizzleProgressionApplicationExecutor implements ProgressionApplicationExecutor {
    constructor(
        @Inject(WORKOUT_TEMPLATE_PLANNING_READER)
        private readonly planning: WorkoutTemplatePlanningReader,
        @Inject(WORKOUT_TEMPLATE_COMMANDS)
        private readonly templates: WorkoutTemplateCommands,
    ) {}

    async resolveTargets(
        input: { readonly scope: RuleScope; readonly target: RuleTarget; readonly profileId: string },
        transaction: unknown,
    ): Promise<readonly ResolvedProgressionTarget[]> {
        if (input.target.mode !== "template")
            throw new ProgressionNotApplicableError(
                `Applying a "${input.target.mode}" target to a planned session is not yet supported`,
                { targetMode: input.target.mode },
            );
        if (input.scope.type !== "template")
            throw new ProgressionNotApplicableError("A template-mode proposal must be scoped to a template");
        const detail = await this.planning.readForPlanning(input.scope.id, transaction);
        if (!detail || detail.template.status !== "active" || detail.template.profileId !== input.profileId)
            throw new ProgressionNotApplicableError("The target template is unavailable for this profile", {
                templateId: input.scope.id,
            });
        return [
            {
                ownerType: "workout-template",
                ownerId: detail.template.id,
                ownerVersion: detail.template.version,
                ownerProfileId: detail.template.profileId,
                prescription: detail.prescription,
            },
        ];
    }

    async applyTarget(
        input: { readonly target: ResolvedProgressionTarget; readonly prescription: SessionPrescriptionState },
        metadata: CommandContext,
        transaction: unknown,
    ): Promise<ProgressionResultRevisionView> {
        // Convert the transformed immutable tree back into a template draft the command can republish
        // (the owner command forces `kind: "template"`, so it is intentionally dropped here).
        const published = draftFromState(input.prescription);
        const detail = await this.templates.update(
            input.target.ownerId,
            input.target.ownerVersion,
            {
                prescription: {
                    activities: published.activities,
                    expectedDurationMs: published.expectedDurationMs,
                    notes: published.notes,
                    sourceKind: published.sourceKind,
                    sourcePrescriptionId: published.sourcePrescriptionId,
                },
            },
            metadata,
            transaction,
        );
        return {
            entityType: "training.workout-template",
            entityId: detail.template.id,
            version: detail.template.version,
            prescriptionId: detail.prescription.id,
        };
    }
}
