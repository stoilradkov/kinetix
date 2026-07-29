# ADR 0003: Training aggregate boundaries and immutable prescription cloning

- Status: Accepted
- Date: 2026-07-29

## Context

Workout templates and planned sessions need rich relational structure — mixed strength
and running activities, exercises, hierarchical set groups, sets, and nested run steps.
At the same time, a completed workout must keep referencing the exact prescription that
was in force when performance began, even after the template it came from is later
edited. Storing prescriptions as entity-attribute-value rows or as opaque JSON would
give up typed query surfaces and relational constraints. Mutating a prescription in
place would silently rewrite the history that completed sessions and analytics depend
on.

Two identities must coexist. A completed session and its planned/actual mappings need
to point at one _exact_ version of a prescribed element. Progression rules and
"update all future occurrences" edits instead need a _stable logical_ identity that
survives being copied into the next version of a template or planned session, without
guessing from names or positions.

## Decision

Templates and planned sessions are separate editable aggregate roots. Each owns a
distinct, immutable `SessionPrescription` tree; a template and a planned session
generated from it always reference different prescription IDs. The prescription tree —
its activities, strength exercises/groups/sets, running activities, and hierarchical run
steps — is the consistency boundary of one published version.

Every prescribed row carries three identities:

- an immutable **row ID** that identifies that exact prescription version. Once a tree
  is published, its rows are never updated or deleted; the database enforces this with
  per-table `BEFORE UPDATE OR DELETE` triggers, not only application behaviour. Exact
  planned/actual mappings reference row IDs.
- a **logical key** that is preserved when the same logical element is copied into the
  next version of one owner. Progression and "update future occurrences" operations
  select by logical key so they survive re-publication. Logical keys are minted UUIDs,
  never derived from name or position.
- optional **source lineage** (`source_row_id`, `source_logical_key`, and the root's
  `source_prescription_id`/`source_kind`) recording the template element a planned
  element was cloned from.

An edit does not mutate the current tree. The owner publishes a _new_ immutable tree:
retained elements keep their logical key and receive a fresh row ID, new elements
receive a new logical key and row ID, and removed elements are simply absent from the
new tree while remaining in prior immutable versions. The owner then advances its
current-prescription pointer and records an aggregate revision.

Publishing and cloning are application capabilities (`PrescriptionPublisher`,
`PrescriptionCloner`) expressed over complete trees, not table CRUD. They generate all
IDs before persistence, write the whole tree through a capability-shaped repository
port, and emit an outbox event inside the caller's Unit of Work transaction so an owner
workflow (template edit, program activation, session resolution) commits the owner
change and the prescription atomically. The domain `SessionPrescription` aggregate is
pure TypeScript: it enforces ordering, target-range, discriminator, ownership, group
membership, and acyclic repeat/group invariants, and it owns the clone/edit key
semantics. Because the tree is immutable and content-addressed by ID, it is not itself a
revisioned aggregate; the editable owner's snapshot references the prescription ID.

Percentage prescriptions (percent of 1RM or training max) remain unresolved in the
planned tree. When a Training session is started, a `resolved_execution` prescription is
cloned from the planned tree, preserving logical keys and source row IDs while recording
the absolute targets, the max, and the equipment configuration used. That resolution is
a later concern; this decision only fixes the immutable structure and the
`resolved_execution` kind so no schema change is needed to add it.

Public contracts expose logical and source lineage as explicit fields with defined
meaning. They never expose infrastructure row IDs as logical-lineage selectors, and
draft/request contracts accept only logical selectors, never a row ID.

## Consequences

Completed sessions and analytics stay reproducible: their references resolve to the
exact rows that existed at performance time regardless of later edits. Progression and
future-occurrence edits remain correct across re-publication because they travel by
logical key. Normalized columns keep prescriptions queryable and constraint-checked
instead of hidden in JSON. The cost is storage growth with every edit and clone, and the
requirement that publishing and cloning always mint fresh row IDs and route through the
application's Unit of Work. Prevention of published-row mutation depends on database
triggers, which live in a hand-written migration because Drizzle's schema DSL cannot
express them; an integration test guards against a future migration dropping them.
