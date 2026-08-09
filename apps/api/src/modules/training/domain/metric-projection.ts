/**
 * Generic derived-metric projection primitives (issue #43, A1; design §16.1–16.3; ADR 0006).
 *
 * Analytics are reproducible projections over authoritative profile, plan, and performance facts. This
 * module holds the *pure* vocabulary the projection framework is built on — the calculator interface, the
 * result/scope/period/dimensions value objects, the source-input references, and the invalidation-scope
 * expansion/coalescing rules. Everything here is deterministic TypeScript: no repositories, no jobs, no
 * persistence, no wire schemas. The adherence projection (issue #37) is the first concrete consumer; the
 * strength/running/1RM calculators (A2–A4) register against the same interface.
 */

// -------------------------------------------------------------------------------------------------
// Dependency categories
// -------------------------------------------------------------------------------------------------

/**
 * The authoritative-fact categories a calculator depends on and an invalidation targets (design §16.3).
 * A calculator declares the dependencies whose change should stale its results; the invalidation planner
 * translates a committed fact into scopes tagged with the dependency that changed.
 */
export type MetricDependency = "session" | "exercise" | "context" | "zone" | "plan";

export const METRIC_DEPENDENCIES: readonly MetricDependency[] = ["session", "exercise", "context", "zone", "plan"];

export function isMetricDependency(value: unknown): value is MetricDependency {
    return typeof value === "string" && (METRIC_DEPENDENCIES as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------------
// Scope / period / dimensions — the natural coordinates of a projected metric
// -------------------------------------------------------------------------------------------------

/**
 * A projection's polymorphic scope (design §16.2: `scope_type/scope_id` is intentionally polymorphic
 * derived data). Every source fact still lives in a foreign-keyed domain table; the scope only names what
 * the metric is *about* — a session, a profile, an exercise family, a program block, etc.
 */
export interface MetricScope {
    readonly type: string;
    readonly id: string;
}

/** The time window a metric covers. `all_time` carries no bounds; the others are canonical local dates. */
export type MetricPeriod =
    | { readonly kind: "all_time" }
    | { readonly kind: "point"; readonly at: string }
    | { readonly kind: "range"; readonly start: string; readonly end: string }
    | { readonly kind: "rolling"; readonly days: number; readonly end: string };

/** Free-form categorical breakdown (exercise id, muscle, formula, …). Stored as canonical string pairs. */
export type MetricDimensions = Readonly<Record<string, string>>;

/** The natural coordinates a calculator is asked to compute — scope, period, and dimensions together. */
export interface MetricTarget {
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly dimensions: MetricDimensions;
}

// -------------------------------------------------------------------------------------------------
// Inputs, values, and results
// -------------------------------------------------------------------------------------------------

/**
 * A reference to one authoritative source fact and the exact revision that fed the calculation. Input rows
 * make a projection explainable and drive targeted invalidation: a change to `entityType/entityId` at a
 * newer revision stales every metric that referenced it.
 */
export interface MetricInputRef {
    readonly entityType: string;
    readonly entityId: string;
    readonly revision: number;
}

/** The scored value of a metric: a numeric and/or textual reading, a canonical unit, and free details. */
export interface DerivedMetricValue {
    readonly numeric: number | null;
    readonly text: string | null;
    readonly unit: string | null;
    readonly details: Readonly<Record<string, unknown>>;
}

/**
 * One deterministic result of a calculator run. The calculator supplies the coordinates, value, and input
 * references; the application service stamps the calculator key/version, the natural key, the source
 * fingerprint, and the calculation time when it persists the projection row.
 */
export interface MetricResult {
    readonly scope: MetricScope;
    readonly period: MetricPeriod;
    readonly dimensions: MetricDimensions;
    readonly value: DerivedMetricValue;
    readonly inputs: readonly MetricInputRef[];
}

// -------------------------------------------------------------------------------------------------
// Calculator interface + context
// -------------------------------------------------------------------------------------------------

/**
 * The facts a calculator scores plus the target it was asked about and its versioned configuration.
 * Infrastructure loads `facts` through a capability-shaped context reader; the shape is calculator
 * specific, so the framework treats it opaquely and each calculator narrows it.
 */
export interface MetricContext<Facts = unknown> {
    readonly target: MetricTarget;
    readonly facts: Facts;
    readonly config: Readonly<Record<string, unknown>>;
}

/**
 * A pure, code-registered, versioned metric calculator (design §16.1). `calculate` is deterministic for a
 * given version, configuration, and input revisions: it loads no repositories, knows nothing about jobs,
 * and mutates no aggregate. It returns zero or more results (one per dimension breakdown it produces).
 */
export interface MetricCalculator<Facts = unknown> {
    readonly key: string;
    readonly version: number;
    readonly dependencies: readonly MetricDependency[];
    calculate(context: MetricContext<Facts>): readonly MetricResult[];
}

// -------------------------------------------------------------------------------------------------
// Findings (design §16.2, §16.8) — schema-level vocabulary; the finding pipeline lands in A5
// -------------------------------------------------------------------------------------------------

export type FindingStatus = "active" | "acknowledged" | "dismissed" | "expired";

export const FINDING_STATUSES: readonly FindingStatus[] = ["active", "acknowledged", "dismissed", "expired"];

/**
 * A qualitative analytics finding (personal record, trend, …) derived from metrics. Findings store their
 * evidence, review/expiry windows, and user feedback, and — like metrics — are versioned and superseded
 * rather than mutated (design §16.8). A1 registers the schema; calculators that emit findings arrive in A5.
 */
export interface FindingValue {
    readonly scope: MetricScope;
    readonly status: FindingStatus;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly reviewAt: string | null;
    readonly expiresAt: string | null;
    readonly feedback: Readonly<Record<string, unknown>> | null;
    readonly inputs: readonly MetricInputRef[];
}

// -------------------------------------------------------------------------------------------------
// Canonicalization — stable descriptors for natural-key and fingerprint hashing
// -------------------------------------------------------------------------------------------------

/** Sort input references so a fingerprint is independent of the order infrastructure loaded them in. */
export function sortInputRefs(inputs: readonly MetricInputRef[]): readonly MetricInputRef[] {
    return [...inputs].sort((left, right) => {
        if (left.entityType !== right.entityType) return left.entityType < right.entityType ? -1 : 1;
        if (left.entityId !== right.entityId) return left.entityId < right.entityId ? -1 : 1;
        return left.revision - right.revision;
    });
}

/**
 * The stable descriptor of a metric's *identity* — calculator key plus its natural coordinates. Hashing
 * this yields the natural key that a partial unique index guards so at most one `current` row exists per
 * (calculator, scope, period, dimensions); the calculator version is deliberately excluded so a new
 * version supersedes the old current result rather than living alongside it.
 */
export function metricNaturalKeyDescriptor(
    calculatorKey: string,
    target: MetricTarget,
): Readonly<Record<string, unknown>> {
    return {
        key: calculatorKey,
        scopeType: target.scope.type,
        scopeId: target.scope.id,
        period: target.period,
        dimensions: target.dimensions,
    };
}

/**
 * The stable descriptor of everything a result *depends on* — its identity, the calculator version and
 * config, and the sorted source revisions. Hashing this yields the source fingerprint; an unchanged
 * fingerprint lets a recompute skip the rewrite, so replaying the same facts is a no-op (design §16.3).
 */
export function metricFingerprintDescriptor(
    calculatorKey: string,
    version: number,
    config: Readonly<Record<string, unknown>>,
    result: MetricResult,
): Readonly<Record<string, unknown>> {
    return {
        key: calculatorKey,
        version,
        config,
        scopeType: result.scope.type,
        scopeId: result.scope.id,
        period: result.period,
        dimensions: result.dimensions,
        value: result.value,
        inputs: sortInputRefs(result.inputs),
    };
}

// -------------------------------------------------------------------------------------------------
// Invalidation scopes
// -------------------------------------------------------------------------------------------------

/**
 * A single "this dependency changed, at this scope" fact produced from a committed event. Workers coalesce
 * overlapping scopes, stale the results that match them, and rebuild the affected projections idempotently.
 */
export interface InvalidationScope {
    readonly dependency: MetricDependency;
    readonly scopeType: string;
    readonly scopeId: string;
}

/** Canonical, order-independent identity of an invalidation scope — the coalescing key. */
export function invalidationScopeKey(scope: InvalidationScope): string {
    return `${scope.dependency}|${scope.scopeType}|${scope.scopeId}`;
}

/** Deduplicate overlapping invalidation scopes, preserving first-seen order (design §16.3 coalescing). */
export function coalesceInvalidations(scopes: readonly InvalidationScope[]): readonly InvalidationScope[] {
    const seen = new Set<string>();
    const coalesced: InvalidationScope[] = [];
    for (const scope of scopes) {
        const key = invalidationScopeKey(scope);
        if (seen.has(key)) continue;
        seen.add(key);
        coalesced.push(scope);
    }
    return coalesced;
}

// -------------------------------------------------------------------------------------------------
// Source-change → invalidation-scope expansion (design §16.3)
// -------------------------------------------------------------------------------------------------

/**
 * A committed fact, enriched by the application planner with the cross-references it fans out to (the
 * exercises/muscles/gear a session touched, the sessions a bodyweight date or zone interval affects, …).
 * `expandInvalidation` is the *pure* mapping from an enriched change to the scopes it stales; resolving the
 * cross-references (which sessions reference a date, which runs fall in a zone interval) is a reader-backed
 * application concern that runs before this function.
 */
export type SourceChange =
    | {
          readonly kind: "session";
          readonly sessionId: string;
          readonly profileId: string;
          readonly localDate?: string | null;
          readonly exerciseIds?: readonly string[];
          readonly muscleIds?: readonly string[];
          readonly gearIds?: readonly string[];
          readonly programIds?: readonly string[];
          readonly programBlockIds?: readonly string[];
          readonly plannedSessionIds?: readonly string[];
      }
    | { readonly kind: "exercise"; readonly exerciseId: string; readonly familyId?: string | null }
    | { readonly kind: "context"; readonly profileId: string; readonly affectedSessionIds?: readonly string[] }
    | { readonly kind: "zone"; readonly zoneId: string; readonly affectedSessionIds?: readonly string[] }
    | {
          readonly kind: "plan";
          readonly plannedSessionId: string;
          readonly affectedSessionIds?: readonly string[];
      };

/**
 * Translate one enriched committed fact into the invalidation scopes it stales (design §16.3):
 *
 * - Session change → the session itself, its local day/week and rolling 7/28-day windows, the linked
 *   program blocks/programs, and every exercise/muscle/gear it touched.
 * - Exercise definition/merge → the affected exercise (and family) so historical/latest-basis results
 *   recompute.
 * - Bodyweight/context change → the sessions whose calculations reference that context.
 * - Zone change → only the runs within the zone definition's effective interval.
 * - Planned revision/mapping change → the plan and every actual session mapped to it.
 */
export function expandInvalidation(change: SourceChange): readonly InvalidationScope[] {
    switch (change.kind) {
        case "session":
            return coalesceInvalidations(sessionScopes(change));
        case "exercise":
            return coalesceInvalidations([
                { dependency: "exercise", scopeType: "exercise", scopeId: change.exerciseId },
                ...(change.familyId ? [scope("exercise", "exercise-family", change.familyId)] : []),
            ]);
        case "context":
            return coalesceInvalidations((change.affectedSessionIds ?? []).map(id => scope("context", "session", id)));
        case "zone":
            return coalesceInvalidations((change.affectedSessionIds ?? []).map(id => scope("zone", "session", id)));
        case "plan":
            return coalesceInvalidations([
                { dependency: "plan", scopeType: "planned-session", scopeId: change.plannedSessionId },
                ...(change.affectedSessionIds ?? []).map(id => scope("plan", "session", id)),
            ]);
    }
}

function sessionScopes(change: Extract<SourceChange, { kind: "session" }>): InvalidationScope[] {
    const scopes: InvalidationScope[] = [scope("session", "session", change.sessionId)];
    if (change.localDate) {
        scopes.push(scope("session", "profile-day", windowScopeId(change.profileId, change.localDate)));
        scopes.push(scope("session", "profile-week", windowScopeId(change.profileId, isoWeekStart(change.localDate))));
        scopes.push(scope("session", "profile-rolling-7", windowScopeId(change.profileId, change.localDate)));
        scopes.push(scope("session", "profile-rolling-28", windowScopeId(change.profileId, change.localDate)));
    }
    for (const id of change.programIds ?? []) scopes.push(scope("session", "program", id));
    for (const id of change.programBlockIds ?? []) scopes.push(scope("session", "program-block", id));
    for (const id of change.plannedSessionIds ?? []) scopes.push(scope("plan", "planned-session", id));
    for (const id of change.exerciseIds ?? []) scopes.push(scope("session", "exercise", id));
    for (const id of change.muscleIds ?? []) scopes.push(scope("session", "muscle", id));
    for (const id of change.gearIds ?? []) scopes.push(scope("session", "gear", id));
    return scopes;
}

function scope(dependency: MetricDependency, scopeType: string, scopeId: string): InvalidationScope {
    return { dependency, scopeType, scopeId };
}

function windowScopeId(profileId: string, anchor: string): string {
    return `${profileId}:${anchor}`;
}

/**
 * The Monday (ISO-8601) that starts the week containing `localDate` (a `YYYY-MM-DD` string), computed in
 * UTC so it never shifts with the process time zone. Window invalidation scopes key on this so a session
 * and its whole calendar week stale together.
 */
export function isoWeekStart(localDate: string): string {
    const date = new Date(`${localDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return localDate;
    const weekday = date.getUTCDay(); // 0 = Sunday … 6 = Saturday
    const mondayOffset = (weekday + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    return date.toISOString().slice(0, 10);
}
