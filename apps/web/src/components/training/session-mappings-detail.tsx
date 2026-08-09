import { Link } from "@tanstack/react-router";

import type { MappingRelationValue, TrainingSessionResponse } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";

type PlannedLink = TrainingSessionResponse["plannedLinks"][number];

const relationVariant: Record<MappingRelationValue, "success" | "info" | "warning" | "secondary"> = {
    matched: "success",
    substituted: "info",
    added: "info",
    partial: "warning",
    combined: "secondary",
    split: "secondary",
};

interface LevelMapping {
    readonly id: string;
    readonly relation: MappingRelationValue;
    readonly reason: string | null;
    readonly prescribedId: string | null;
    readonly actualId: string;
}

/**
 * Read-only inspector for a session's planned/actual mappings (design 11.4, TS-4). It surfaces which
 * planned session and frozen prescriptions the work was performed against, and how each performed row
 * maps back to its prescribed row — including substitutions, additions, splits, and combines with their
 * explicit reasons. No adherence maths lives here; that is an analytics concern.
 */
export function SessionMappingsDetail({
    session,
}: {
    readonly session: TrainingSessionResponse;
}): React.JSX.Element | null {
    const levels: { readonly label: string; readonly rows: readonly LevelMapping[] }[] = [
        {
            label: "Exercises",
            rows: session.occurrenceMappings.map(m => ({
                id: m.id,
                relation: m.relation,
                reason: m.reason,
                prescribedId: m.prescribedExerciseId,
                actualId: m.occurrenceId,
            })),
        },
        {
            label: "Sets",
            rows: session.setMappings.map(m => ({
                id: m.id,
                relation: m.relation,
                reason: m.reason,
                prescribedId: m.prescribedSetId,
                actualId: m.performedSetId,
            })),
        },
        {
            label: "Activities",
            rows: session.activityMappings.map(m => ({
                id: m.id,
                relation: m.relation,
                reason: m.reason,
                prescribedId: m.prescribedActivityId,
                actualId: m.actualActivityId,
            })),
        },
    ].filter(level => level.rows.length > 0);

    if (session.plannedLinks.length === 0 && levels.length === 0) return null;

    return (
        <section className="grid gap-3">
            <h3 className="text-sm font-medium">Planned vs. actual</h3>
            {session.plannedLinks.map(link => (
                <PlannedLinkCard key={link.plannedSessionId} link={link} />
            ))}
            {levels.map(level => (
                <div className="border-border grid gap-2 rounded-lg border p-4" key={level.label}>
                    <span className="text-muted-foreground text-xs font-medium">{level.label}</span>
                    {level.rows.map(row => (
                        <div className="flex items-center gap-2 text-xs" key={row.id}>
                            <Badge variant={relationVariant[row.relation]}>{row.relation}</Badge>
                            <span className="text-muted-foreground truncate font-mono">
                                {row.prescribedId ? `${short(row.prescribedId)} → ` : "unplanned → "}
                                {short(row.actualId)}
                            </span>
                            {row.reason ? <span className="text-muted-foreground truncate">· {row.reason}</span> : null}
                        </div>
                    ))}
                </div>
            ))}
        </section>
    );
}

function PlannedLinkCard({ link }: { readonly link: PlannedLink }): React.JSX.Element {
    const frozen = link.resolvedPrescriptionId !== link.sourcePrescriptionId;
    return (
        <div className="border-border grid gap-1 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="info">{link.plannedSessionId === null ? "reference" : "planned"}</Badge>
                <span className="text-muted-foreground truncate">
                    {link.plannedSessionId === null
                        ? "template/previous"
                        : (link.plannedSessionTitle ?? short(link.plannedSessionId))}
                </span>
                {link.programId !== null && link.programName !== null ? (
                    // Targets the programs area today; retarget to `/training/programs/$id` once #67 ships.
                    <Link
                        className="text-foreground hover:text-primary underline underline-offset-4"
                        to="/training/programs"
                    >
                        {link.programName}
                    </Link>
                ) : null}
                {frozen ? <Badge variant="secondary">targets frozen</Badge> : null}
            </div>
            <span className="text-muted-foreground font-mono text-xs">
                execution prescription {short(link.resolvedPrescriptionId)}
            </span>
        </div>
    );
}

function short(id: string): string {
    return id.slice(0, 8);
}
