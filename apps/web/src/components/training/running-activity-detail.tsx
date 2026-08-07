import type { SessionActivityResponse } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";

type Running = NonNullable<SessionActivityResponse["running"]>;
type Measure = { readonly value: number; readonly unit: string };

type RunStep = Running["steps"][number];
type RunSplit = Running["splits"][number];
type RunZoneTime = Running["zoneTimes"][number];

/**
 * Read-only inspector for the running detail of a session (design 11.3; PRD R1–R6). It renders the
 * recorded summary metrics, run-classification tags, indoor/treadmill state, and the derived average
 * pace, plus the structured hierarchy: performed run steps (with nested repeats), arbitrary splits,
 * heart-rate/pace/power zone times, the route reference, and the gear item. The distinction between a
 * missing metric and a recorded zero stays explicit; pace is a derived projection, never authoritative.
 */
export function RunningActivityDetail({
    activities,
}: {
    readonly activities: readonly SessionActivityResponse[];
}): React.JSX.Element | null {
    const runningActivities = activities.filter(
        (activity): activity is SessionActivityResponse & { running: Running } =>
            activity.type === "running" && activity.running !== null,
    );
    if (runningActivities.length === 0) return null;

    return (
        <section className="grid gap-3">
            <h3 className="text-sm font-medium">Running detail</h3>
            {runningActivities.map(activity => (
                <RunningCard activity={activity} key={activity.id} />
            ))}
        </section>
    );
}

function RunningCard({
    activity,
}: {
    readonly activity: SessionActivityResponse & { running: Running };
}): React.JSX.Element {
    const running = activity.running;
    return (
        <div className="border-border grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="info">Pace {formatPace(running.derivedPace.secondsPerKilometre)}/km</Badge>
                {running.indoor ? <Badge variant="outline">indoor</Badge> : null}
                {running.treadmill ? <Badge variant="outline">treadmill</Badge> : null}
                {running.runTags.map(tag => (
                    <Badge key={tag} variant="secondary">
                        {tag}
                    </Badge>
                ))}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                <Metric label="Distance" value={formatMeasure(running.distance)} />
                <Metric label="Moving time" value={formatMeasure(running.movingTime)} />
                <Metric label="Elapsed time" value={formatMeasure(running.elapsedTime)} />
                <Metric label="Avg HR" value={formatCount(running.averageHeartRate, "bpm")} />
                <Metric label="Max HR" value={formatCount(running.maxHeartRate, "bpm")} />
                <Metric label="Avg cadence" value={formatCount(running.averageCadence, "spm")} />
                <Metric label="Avg power" value={formatCount(running.averagePower, "W")} />
                <Metric label="Elevation +" value={formatMeasure(running.elevationGain)} />
                <Metric label="Elevation −" value={formatMeasure(running.elevationLoss)} />
                <Metric label="Calories" value={formatCount(running.calories, "kcal")} />
                <Metric label="VO₂max" value={formatCount(running.vo2Max, "")} />
                <Metric label="RPE" value={formatCount(running.rpe, "")} />
            </dl>
            {(running.route !== null || running.gearItemId !== null) && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {running.route !== null ? (
                        <Badge variant="outline">
                            Route{running.route.ref ? ` ${running.route.ref}` : ""}
                            {running.route.geometry ? ` · ${running.route.geometry.coordinates.length} pts` : ""}
                        </Badge>
                    ) : null}
                    {running.gearItemId !== null ? <Badge variant="secondary">Gear</Badge> : null}
                </div>
            )}
            <RunStepList steps={running.steps} />
            <SplitTable splits={running.splits} />
            <ZoneTimeList zoneTimes={running.zoneTimes} />
        </div>
    );
}

/** Hierarchical performed run steps: roots in order, each repeat's children nested and `×N` labelled. */
function RunStepList({ steps }: { readonly steps: readonly RunStep[] }): React.JSX.Element | null {
    if (steps.length === 0) return null;
    const roots = steps
        .filter(step => step.parentStepId === null)
        .slice()
        .sort(byPosition);
    return (
        <div className="grid gap-1.5">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Steps</h4>
            <ul className="grid gap-1">
                {roots.map(step => (
                    <RunStepRow key={step.id} step={step} steps={steps} depth={0} />
                ))}
            </ul>
        </div>
    );
}

function RunStepRow({
    step,
    steps,
    depth,
}: {
    readonly step: RunStep;
    readonly steps: readonly RunStep[];
    readonly depth: number;
}): React.JSX.Element {
    const children = steps
        .filter(candidate => candidate.parentStepId === step.id)
        .slice()
        .sort(byPosition);
    return (
        <li>
            <div className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${depth * 12}px` }}>
                <Badge variant="outline">{step.type.replace("_", " ")}</Badge>
                {step.repeatCount !== null ? <span className="font-mono tabular-nums">×{step.repeatCount}</span> : null}
                <span className="text-muted-foreground font-mono tabular-nums">{stepSummary(step)}</span>
            </div>
            {children.length > 0 ? (
                <ul className="mt-1 grid gap-1">
                    {children.map(child => (
                        <RunStepRow key={child.id} step={child} steps={steps} depth={depth + 1} />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function stepSummary(step: RunStep): string {
    const parts = [formatMeasureOptional(step.measurements.distance), formatMeasureOptional(step.measurements.duration)]
        .filter((part): part is string => part !== null)
        .join(" · ");
    return parts;
}

function SplitTable({ splits }: { readonly splits: readonly RunSplit[] }): React.JSX.Element | null {
    if (splits.length === 0) return null;
    return (
        <div className="grid gap-1.5">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Splits</h4>
            <ul className="grid gap-1 text-sm">
                {splits
                    .slice()
                    .sort(byPosition)
                    .map(split => (
                        <li key={split.id} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">#{split.position + 1}</span>
                            <span className="font-mono tabular-nums">
                                {[
                                    formatMeasureOptional(split.distance),
                                    formatMeasureOptional(split.movingTime),
                                    formatCountOptional(split.averageHeartRate, "bpm"),
                                ]
                                    .filter((part): part is string => part !== null)
                                    .join(" · ") || "—"}
                            </span>
                        </li>
                    ))}
            </ul>
        </div>
    );
}

function ZoneTimeList({ zoneTimes }: { readonly zoneTimes: readonly RunZoneTime[] }): React.JSX.Element | null {
    if (zoneTimes.length === 0) return null;
    return (
        <div className="grid gap-1.5">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Zone time</h4>
            <ul className="grid gap-1 text-sm">
                {zoneTimes
                    .slice()
                    .sort(byPosition)
                    .map(zoneTime => (
                        <li key={zoneTime.id} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                                <Badge variant="info">{zoneTime.family.replace("_", " ")}</Badge>
                                {zoneTime.zoneName ? (
                                    <span className="text-muted-foreground">{zoneTime.zoneName}</span>
                                ) : null}
                            </span>
                            <span className="font-mono tabular-nums">{formatMeasure(zoneTime.duration)}</span>
                        </li>
                    ))}
            </ul>
        </div>
    );
}

function byPosition(a: { readonly position: number }, b: { readonly position: number }): number {
    return a.position - b.position;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
    const missing = value === "—";
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={missing ? "text-muted-foreground" : "font-mono tabular-nums"}>{value}</dd>
        </div>
    );
}

/** A missing metric renders as an em dash; a recorded zero renders as `0` so the two stay distinct. */
function formatMeasure(measure: Measure | null): string {
    return measure === null ? "—" : `${measure.value}${measure.unit}`;
}

function formatCount(value: number | null, unit: string): string {
    return value === null ? "—" : unit ? `${value} ${unit}` : `${value}`;
}

/** Like {@link formatMeasure}/{@link formatCount} but returns `null` for absent values so lists can omit them. */
function formatMeasureOptional(measure: Measure | null): string | null {
    return measure === null ? null : `${measure.value}${measure.unit}`;
}

function formatCountOptional(value: number | null, unit: string): string | null {
    return value === null ? null : `${value} ${unit}`;
}

/** Render seconds-per-kilometre as a `m:ss` pace, or an em dash when it could not be derived. */
function formatPace(secondsPerKilometre: number | null): string {
    if (secondsPerKilometre === null) return "—";
    const total = Math.round(secondsPerKilometre);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
