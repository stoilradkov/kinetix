import type { ProgressionAction } from "@kinetix/types";

/** One-line human summary of a single progression-rule action. */
export function describeAction(action: ProgressionAction): string {
    switch (action.type) {
        case "adjust_load":
            return action.mode === "percent"
                ? `Adjust load by ${action.value}%`
                : `Adjust load by ${action.value} ${action.unit ?? ""}`.trim();
        case "adjust_reps":
            return `Adjust reps by ${action.value}`;
        case "adjust_sets":
            return `Adjust sets by ${action.value}`;
        case "set_effort_target":
            return `Set effort target${action.rpe !== undefined ? ` RPE ${action.rpe}` : ""}${
                action.rir !== undefined ? ` RIR ${action.rir}` : ""
            }`;
        case "adjust_run_target":
            return `Adjust ${action.field} by ${action.value}${action.mode === "percent" ? "%" : ""}`;
        case "substitute_exercise":
            return `Substitute exercise ${action.exerciseId.slice(0, 8)}`;
        case "repeat_block":
            return "Repeat block";
        case "insert_deload":
            return "Insert deload";
        case "reschedule_session":
            return `Reschedule by ${action.offsetDays} day(s)`;
        case "skip_session":
            return `Skip session (${action.reason})`;
        case "recommendation":
            return `Recommend: ${action.messageTemplate}`;
        default:
            return "Unknown action";
    }
}
