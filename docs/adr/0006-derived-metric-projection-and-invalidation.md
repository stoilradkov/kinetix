# ADR 0006: Derived metric projection and invalidation strategy

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Kinetix maintainers
- Related: Training PRD AD-1–3, AN-1, AC-4; Training design sections 16.2, 16.3,
  16.7; ADR 0002 (revisions), ADR 0004 (jobs and outbox). First implemented by
  issue #37 (AD1, adherence).

## Context

Kinetix derives analytics — starting with prescription **adherence** — from
authoritative session, mapping, and prescription facts. Derived results must be
explainable, reproducible, and safe to rebuild: a formula or an input can change,
so a result cannot be trusted as authoritative and cannot be silently mutated in
place. The training design (sections 16.2–16.3) calls for projection tables that
record their source revisions, inputs, exclusions, formula version, and
calculation time, plus an event-driven invalidation path that recomputes stale
projections idempotently.

Adherence (issue #37) is the first such projection and establishes the pattern
the later analytics slice (findings, records, strength/running/load/1RM
projections) will reuse.

## Decision

**Projections are derived, versioned, and never authoritative.** Raw facts stay
in foreign-keyed domain tables. A projection row stores the source aggregate
identity and revision, a content fingerprint over its scoring inputs, the formula
name/version, the calculated values, the evidence/exclusions, and its lifecycle
state. Recomputation never mutates a result in place: it marks the current row
`superseded` and inserts a new `current` row, so history is preserved and a
partial unique index guarantees at most one `current` result per natural key.

**Calculators are pure, code-registered, and versioned.** A calculator is a pure
function of domain state carrying a `name`/`version`; it loads no repositories and
persists nothing, returning component scores, evidence, and exclusions as values.
Calculators are registered in a `name.vN` registry (mirroring the durable-work
handler registries), so a formula can evolve to a new version without rewriting
previously stored results. The authoritative `adherence.overall.v1` policy
(section 16.7) is defined in domain code and summarised below.

**Application orchestrates; infrastructure adapts.** A `CalculateAdherence`
application service loads the exact planned/resolved/actual revisions through
read-only, mapping-aware reader ports, invokes the registered calculator once per
linked planned prescription, computes a source fingerprint, and persists through
an idempotent projection port inside a `UnitOfWork` transaction. When the
fingerprint matches the current result the rewrite is skipped, so replaying the
same facts is a no-op. Drizzle rows never leave infrastructure.

**Invalidation rides the transactional outbox (ADR 0004).** Session and mapping
facts already carry `invalidation.adherence` metadata and the linked planned
session IDs. An outbox handler enqueues a durable `adherence.recalculate` job
(keyed by session id so repeats coalesce) when a fact marks adherence stale; a
planned-session change fans out one recompute per actual session mapped to the
plan. A job handler runs `CalculateAdherence` idempotently, guarded by the
handler receipt and the fingerprint skip. A synchronous diagnostic endpoint uses
the same service for deterministic verification.

### `adherence.overall.v1` (authoritative)

Each component scores target compliance from 0–100: a value inside the target
range scores 100, otherwise a linear penalty against the nearest violated
boundary in canonical units (`100 * max(0, 1 - |a - boundary| / max(|boundary|,
1))`), with a missing bound imposing no limit on that side. Missing or
non-comparable components are excluded and the remaining weights are
renormalised — never scored zero. Cancelled prescriptions are reported but
excluded from the denominator. Categorical completion is 100 for completed, 0 for
skipped, and mapped-child fractions for partial work. Added work is reported as
divergence and never lowers completion; a substitution counts as exercise
completion with a separate flag while volume/intensity still compare only
compatible measurements. One-to-many/many-to-one mappings aggregate comparable
quantities over the distinct prescribed and performed entities before scoring.

Initial weights (both tables sum to 100; session completion is shared, so the
per-activity block carries the remaining 95):

- Strength: session 5, exercise 15, set 20, reps 20, load 15, volume 15,
  intensity 10.
- Running: session 5, step 20, distance 25, duration 20, pace 20, intensity 10.

`session_completion` is scored once at the session scope. The 95-weight
per-activity block is split across activities by planned expected duration when
every activity provides it, otherwise equally (the mixed-session rule); within an
activity, its type's remaining components are renormalised over the included ones.

## Consequences

- Analytics can be invalidated, marked stale, and rebuilt without corrupting the
  authoritative history; every result explains its inputs, exclusions, formula
  version, and calculation time.
- Changing a formula means shipping a new calculator version, not rewriting
  stored rows; results keep the version that produced them.
- Adherence is the first durable-work consumer; the outbox → job → projection
  path is now exercised end to end.
- Superseded rows accumulate for auditability; a future retention/compaction job
  can prune them if volume warrants.
- The generic metric-projection framework, the coalescing
  `analytics_invalidations` table, findings, records, and trends remain deferred
  to the analytics slice; AD1 ships only the adherence projection and its
  dedicated tables.

## Rejected alternatives

- **Store adherence on the session aggregate:** couples derived analytics to the
  write model and makes rebuilds mutate authoritative facts.
- **Mutate a single result row in place on recompute:** loses history and the
  ability to explain a superseded result; races with concurrent readers.
- **Compute inline during session completion only:** cannot rebuild after a
  formula change or a late mapping edit, and blocks the write path on analytics.
- **A generic key/value metric store now:** premature; typed adherence tables
  keep the projection explainable and foreign-keyed for MVP.
