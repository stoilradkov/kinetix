# ADR 0002: Normalized current state with immutable aggregate snapshots

- Status: Accepted
- Date: 2026-07-12

## Context

Programs, templates, exercises, sessions, and rules remain editable, but a user must be able to explain how their current form arose and restore an earlier form. Event sourcing would make every read and migration depend on replay, while keeping only audit fields cannot reproduce earlier aggregate state.

## Decision

The owning module keeps each aggregate's current state normalized in its relational tables. Every successful creation or mutation also appends a complete, immutable snapshot to the platform-owned `entity_revisions` table in the same transaction. A revision is identified by aggregate type, aggregate ID, and monotonically increasing version and records snapshot schema version, source, actor, reason, human-readable summary, correlation ID, and timestamp.

The snapshot boundary is the consistency boundary of the aggregate: a Program snapshot includes its blocks and planned sessions; a Template includes its ordered prescription tree; an Exercise includes aliases and defaults; a Session includes its prescribed/performed entries and sets; and a Rule includes its complete condition and action definition. Snapshots do not absorb independently owned aggregates, files, provider payloads, or another module's state; those remain references by stable ID.

Snapshot serializers live in the application layer (with module-specific implementations) rather than domain entities. They emit the current schema version and must validate or migrate older snapshot shapes before producing domain state. Public history contracts expose revision metadata and a versioned resource representation, never raw persistence JSON.

Mutations use optimistic expected-version checks and a Unit of Work. The application coordinator writes normalized state, appends its revision, and emits transactional events together. Repositories participate in the supplied transaction and never open hidden transactions.

Restore is a new mutation: the selected snapshot is validated/migrated, saved as current state at `current version + 1`, and appended with source `restore`. Existing revisions are never updated, deleted, or renumbered.

## Consequences

Current queries stay relational and efficient while history is explainable and restorable. Snapshot storage grows with edits and schema evolution requires explicit migrators. Aggregate serializers must be deterministic and avoid leaking infrastructure or wire types into the domain. Concurrent writes are rejected through expected-version checks and the database uniqueness constraint provides a final guard.
