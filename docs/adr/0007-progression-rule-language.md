# ADR 0007: Bounded, versioned progression rule language

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Kinetix maintainers
- Related: Training PRD PG-1–3 (rule format, conditions, actions); Training design
  sections 15.1–15.2; ADR 0002 (immutable aggregate revisions), ADR 0003
  (aggregate boundaries and logical keys), ADR 0004 (jobs and outbox). First
  implemented by issue #39 (G1). Evaluation (G2), safety execution and conflict
  detection (G3), and approval/application (G4) build on this decision.

## Context

Progression rules are executable product configuration: they decide how a plan
changes in response to performance. That makes them a security and correctness
boundary. A rule that could carry arbitrary code, free-form expressions, or
unbounded structure would let stored data drive unbounded computation and would be
impossible to explain, diff, or safely migrate. Rules must also survive template
and plan re-publication: an "increase load on this exercise next week" rule cannot
break because the exercise was copied into a new immutable prescription version
(ADR 0003).

This ADR fixes only the rule **language** and its **storage and CRUD**. It does not
decide how rules are evaluated, how safety limits are enforced, or how proposals are
approved — those are later decisions that consume the structure fixed here.

## Decision

### A bounded, versioned expression tree — never code

A rule condition is a recursive **AST** with exactly four node kinds discriminated
by a `kind` field: `all` (every child true), `any` (some child true), `not` (negate
one child), and `metric` (a single comparison). `all`/`any` groups must be
non-empty; the tree is bounded to a maximum nesting depth and a maximum number of
children per group. There is no expression evaluation, no interpolation, and no way
to name a metric, operator, filter, unit, or action that is not on an allowlist.
The condition and action payloads each carry an explicit integer **schema version**;
an unknown schema version is rejected on the wire and again on hydration from the
database.

### Code registries, not open strings

Metric keys, comparison operators, action types, action fields, and safety-limit
keys come from explicit **code registries** in the domain layer. The metric
registry records each key's value type (number or boolean) and the operators it
permits, so `readiness lt 4` is valid while `readiness eq true` or
`readiness between 4` is rejected with a precise path. Metric filters are restricted
to an allowlisted set of keys. The action registry is a discriminated union keyed by
`type` with field-specific values and units (for example `adjust_load` carries a
`mode` of `absolute` or `percent`; `adjust_run_target` carries a `field` of
`duration`/`distance`/`pace`/`power`). The action union covers every PRD PG-3 action.
Registries are the single source of truth; the wire contracts mirror them as Zod
enums and discriminated unions, and both are validated at the boundary.

### Logical target selectors, independent of persistence

A rule is **attached** to a scope — `program`, `block`, `template`, `exercise`, or
`set` — recorded as a scope type plus the scoped entity's id. What a rule's actions
**target** is expressed separately as a target **mode** (`next` occurrence,
`block_future` — all future occurrences in the current block, or the underlying
`template`) plus a **logical target selector**. Selectors travel by **logical key**
(ADR 0003), never by immutable row id, so they keep pointing at the same logical
plan element after the plan is re-published. The rule aggregate is pure and never
queries plans itself: the application layer resolves and validates scope targets
through a planning-reader port, rejecting unknown or archived targets, and passes
only validated data to the aggregate.

### Approval is the default; template mutation is restricted

Every rule carries `enabled` and `autoApply` flags and a safety-policy
**reference and configuration** (a policy key plus a bounded object of configurable
numeric limits). The stored default is a proposal requiring approval: `autoApply` is
off unless explicitly set. A rule whose target mode is `template` may never enable
`autoApply` — template-level changes always require human approval — and the domain
aggregate rejects that combination. The safety configuration is stored as validated
data here; the checks that consume it are a later decision (G3).

### Persistence and lifecycle

A rule is a versioned, archivable aggregate root following the platform revision
pattern (ADR 0002): its current state lives in a dedicated `progression_rules`
table with an optimistic-lock `version` column, and its full history — including the
JSON AST and actions — is snapshotted into the shared `entity_revisions` log under
the `training.progression-rule` entity type. The AST, action list, triggers, scope,
selector, and safety configuration are stored as validated JSON columns and are
revalidated through the domain model on every hydration; the database never executes
a stored expression. Create/update/show/list/archive/restore, revision history, and
snapshot restore are exposed identically through the REST API, the `kin` CLI, and the
web rule editor and read view, with ETag/`If-Match` optimistic concurrency and
schema/registry errors reported with exact field paths.

## Consequences

Rules are explainable and safe to store, diff, and migrate: the structure is
bounded, every leaf is allowlisted, and schema versions gate both the wire and the
database. Selectors survive re-publication because they travel by logical key.
Keeping the aggregate pure and resolving targets through a planning-reader port
preserves the inward dependency direction and keeps plan queries out of the domain.
The cost is that extending the language — a new metric, action, filter, or safety
limit — is a deliberate code change to a registry plus a schema-version bump and a
snapshot migration, not a data edit; this is intentional for a security boundary.
Evaluation, safety enforcement, conflict detection, and approval are deferred to
G2–G4, which consume but do not change the structure fixed here.
