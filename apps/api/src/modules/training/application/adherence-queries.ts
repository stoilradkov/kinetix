import type { AdherenceResultView } from "#src/modules/training/application/adherence";
import type { AdherenceScope } from "#src/modules/training/domain/index";

// -------------------------------------------------------------------------------------------------
// DI tokens
// -------------------------------------------------------------------------------------------------

export const ADHERENCE_RESULT_QUERY = Symbol("ADHERENCE_RESULT_QUERY");
export const ADHERENCE_RECALC_STATE_READER = Symbol("ADHERENCE_RECALC_STATE_READER");
export const ADHERENCE_QUERY_SERVICE = Symbol("ADHERENCE_QUERY_SERVICE");

/** The scope an adherence *result* can carry (never the session-only scope). */
export type AdherenceResultScope = Exclude<AdherenceScope, "session">;

/** Recalculation state of a stored result relative to the current session facts (issue #38, AD2). */
export type AdherenceRecalcStatus = "current" | "stale" | "pending" | "failed";

// -------------------------------------------------------------------------------------------------
// Read models
// -------------------------------------------------------------------------------------------------

/** A queried adherence result plus the denormalised planned-session title used for direct links. */
export interface AdherenceResultQueryRow extends AdherenceResultView {
    readonly plannedSessionTitle: string | null;
}

/** A queried result annotated with its live recalculation status (AD2 read DTO). */
export interface AdherenceResultDetail extends AdherenceResultQueryRow {
    readonly status: AdherenceRecalcStatus;
}

/** All current adherence results for one session, each annotated with its recalculation status. */
export interface SessionAdherenceDetailView {
    readonly trainingSessionId: string;
    readonly results: readonly AdherenceResultDetail[];
}

/** A keyset-paginated page of adherence results across sessions (newest-computed first). */
export interface AdherenceQueryPage {
    readonly items: readonly AdherenceResultDetail[];
    readonly nextCursor: string | null;
}

// -------------------------------------------------------------------------------------------------
// Capability ports
// -------------------------------------------------------------------------------------------------

/**
 * Filter over the adherence-result projection (design §18.2/§18.3). Every field is optional and combines
 * with AND. `programId`/`blockId` resolve through the planned session a result scores; `from`/`to` bound
 * the actual session's local date. `limit` is already clamped by the caller; `cursor` is opaque.
 */
export interface AdherenceResultQueryCriteria {
    readonly limit: number;
    readonly cursor?: string;
    readonly trainingSessionId?: string;
    readonly plannedSessionId?: string;
    readonly programId?: string;
    readonly blockId?: string;
    readonly scope?: AdherenceResultScope;
    readonly from?: string;
    readonly to?: string;
}

export interface AdherenceResultQueryPageRows {
    readonly items: readonly AdherenceResultQueryRow[];
    readonly nextCursor: string | null;
}

/**
 * Read-only, index-aware projection over `adherence_results` (current state only). Kept separate from the
 * write-path {@link AdherenceResultRepository} because a query never mutates and joins source records
 * (planned session, program/block membership) that the projection store has no reason to know about.
 */
export interface AdherenceResultQueryPort<Transaction = unknown> {
    query(criteria: AdherenceResultQueryCriteria, transaction?: Transaction): Promise<AdherenceResultQueryPageRows>;
    readForSession(sessionId: string, transaction?: Transaction): Promise<readonly AdherenceResultQueryRow[]>;
}

/** The durable-recompute state for one session, sourced from the jobs table + the session root version. */
export interface AdherenceRecalcState {
    /** The session root's current version, or `null` if the session no longer exists. */
    readonly currentSessionVersion: number | null;
    /** The status of the coalesced `adherence.recalculate:<sessionId>` job, or `null` when none exists. */
    readonly jobStatus: "queued" | "running" | "succeeded" | "failed" | null;
}

/**
 * Reads the recompute state of many sessions in bounded round-trips: their current root version and the
 * status of the coalesced adherence recompute job. The application composes these into a per-result
 * {@link AdherenceRecalcStatus} without recomputing scores.
 */
export interface AdherenceRecalcStateReader<Transaction = unknown> {
    readStates(
        sessionIds: readonly string[],
        transaction?: Transaction,
    ): Promise<ReadonlyMap<string, AdherenceRecalcState>>;
}

// -------------------------------------------------------------------------------------------------
// Status composition (pure)
// -------------------------------------------------------------------------------------------------

/**
 * Compose a stored result's recalculation status from the session's live recompute state (design §16.3).
 * A queued/running job means a recompute is in flight (`pending`); a failed job surfaces `failed`; a newer
 * session version with no in-flight job means the result lags the facts (`stale`); otherwise `current`.
 * With no state (session unknown) the stored result is reported as-is (`current`).
 */
export function deriveAdherenceStatus(
    result: Pick<AdherenceResultView, "trainingSessionVersion">,
    state: AdherenceRecalcState | null,
): AdherenceRecalcStatus {
    if (state === null) return "current";
    if (state.jobStatus === "failed") return "failed";
    if (state.jobStatus === "queued" || state.jobStatus === "running") return "pending";
    if (state.currentSessionVersion !== null && state.currentSessionVersion > result.trainingSessionVersion)
        return "stale";
    return "current";
}

// -------------------------------------------------------------------------------------------------
// Query service
// -------------------------------------------------------------------------------------------------

interface AdherenceQueryRuntime<Transaction> {
    readonly query: AdherenceResultQueryPort<Transaction>;
    readonly stateReader: AdherenceRecalcStateReader<Transaction>;
}

/**
 * Read-side query service for adherence (issue #38, AD2). It reads the current result projection through
 * a bounded, index-aware port and annotates every row with its live recalculation status, so API/CLI/web
 * surfaces render identical scores, components, evidence, exclusions, formula version, and stale/pending
 * labels. It never scores or mutates: all formula logic stays in the AD1 domain calculators.
 */
export class AdherenceQueryService<Transaction = unknown> {
    constructor(private readonly runtime: AdherenceQueryRuntime<Transaction>) {}

    /** Read a keyset-paginated page of results across sessions matching the filter, newest-computed first. */
    async queryResults(criteria: AdherenceResultQueryCriteria, transaction?: Transaction): Promise<AdherenceQueryPage> {
        const page = await this.runtime.query.query(criteria, transaction);
        const items = await this.annotate(page.items, transaction);
        return { items, nextCursor: page.nextCursor };
    }

    /** Read every current result for one session (one per linked planned prescription), status-annotated. */
    async readForSession(sessionId: string, transaction?: Transaction): Promise<SessionAdherenceDetailView> {
        const rows = await this.runtime.query.readForSession(sessionId, transaction);
        const results = await this.annotate(rows, transaction);
        return { trainingSessionId: sessionId, results };
    }

    private async annotate(
        rows: readonly AdherenceResultQueryRow[],
        transaction?: Transaction,
    ): Promise<AdherenceResultDetail[]> {
        if (rows.length === 0) return [];
        const sessionIds = [...new Set(rows.map(row => row.trainingSessionId))];
        const states = await this.runtime.stateReader.readStates(sessionIds, transaction);
        return rows.map(row => ({
            ...row,
            status: deriveAdherenceStatus(row, states.get(row.trainingSessionId) ?? null),
        }));
    }
}
