import type { SessionActivityResponse } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";

type Strength = NonNullable<SessionActivityResponse["strength"]>;
type Occurrence = Strength["occurrences"][number];
type PerformedSet = Occurrence["performedSets"][number];
type MassValue = NonNullable<PerformedSet["measurements"]["externalLoad"]>;

const statusVariant: Record<PerformedSet["status"], "success" | "warning" | "destructive" | "info"> = {
    completed: "success",
    partial: "warning",
    skipped: "destructive",
    added: "info",
};

/**
 * Read-only inspector for the structured strength facts of a session (design 11.2; PRD ST-1–7). It
 * renders occurrences, their performed sets, and set-group membership without any derived
 * volume/1RM logic — those live in analytics, never in the view.
 */
export function StrengthActivityDetail({
    activities,
}: {
    readonly activities: readonly SessionActivityResponse[];
}): React.JSX.Element | null {
    const strengthActivities = activities.filter(
        (activity): activity is SessionActivityResponse & { strength: Strength } =>
            activity.type === "strength" && activity.strength !== null && activity.strength.occurrences.length > 0,
    );
    if (strengthActivities.length === 0) return null;

    return (
        <section className="grid gap-3">
            <h3 className="text-sm font-medium">Strength detail</h3>
            {strengthActivities.map(activity => (
                <div className="border-border grid gap-3 rounded-lg border p-4" key={activity.id}>
                    {activity.strength.occurrences
                        .slice()
                        .sort((a, b) => a.position - b.position)
                        .map(occurrence => (
                            <OccurrenceRow
                                groups={activity.strength.setGroups}
                                key={occurrence.id}
                                occurrence={occurrence}
                            />
                        ))}
                </div>
            ))}
        </section>
    );
}

function OccurrenceRow({
    occurrence,
    groups,
}: {
    readonly occurrence: Occurrence;
    readonly groups: Strength["setGroups"];
}): React.JSX.Element {
    const memberships = groups.filter(group => group.members.some(member => member.occurrenceId === occurrence.id));
    return (
        <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{occurrence.snapshot.name}</span>
                <Badge variant="outline">{occurrence.snapshot.repetitionSemantics.replace("_", " ")}</Badge>
                {memberships.map(group => (
                    <Badge key={group.id} variant="info">
                        {group.type.replace("_", " ")}
                        {group.rounds !== null ? ` ×${group.rounds}` : ""}
                    </Badge>
                ))}
            </div>
            <ul className="grid gap-1">
                {occurrence.performedSets
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map(set => (
                        <li className="flex flex-wrap items-center gap-1.5 text-sm" key={set.id}>
                            <Badge variant={statusVariant[set.status]}>{set.status}</Badge>
                            <span className="text-muted-foreground">{set.setType.replace("_", " ")}</span>
                            <span className="font-mono tabular-nums">{describeSet(set)}</span>
                        </li>
                    ))}
            </ul>
        </div>
    );
}

/** Compose a compact, unit-labelled description from the recorded facts (no derived metrics). */
function describeSet(set: PerformedSet): string {
    const parts: string[] = [];
    const measurements = set.measurements;
    if (measurements.reps !== null) parts.push(`${measurements.reps} reps`);
    const load =
        measurements.externalLoad ?? measurements.effectiveLoad ?? measurements.addedLoad ?? measurements.bodyweight;
    if (load) parts.push(formatMass(load));
    if (measurements.assistanceLoad) parts.push(`−${formatMass(measurements.assistanceLoad)} assist`);
    if (measurements.duration) parts.push(`${measurements.duration.value}${measurements.duration.unit}`);
    if (measurements.distance) parts.push(`${measurements.distance.value}${measurements.distance.unit}`);
    if (measurements.powerWatts !== null) parts.push(`${measurements.powerWatts}W`);
    if (measurements.rpe !== null) parts.push(`RPE ${measurements.rpe}`);
    if (measurements.rir !== null) parts.push(`RIR ${measurements.rir}`);
    return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatMass(mass: MassValue): string {
    return `${mass.value}${mass.unit}`;
}
