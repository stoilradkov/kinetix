# ADR 0005: Cross-module profile references without a foreign key

- Status: Accepted
- Date: 2026-07-27
- Decision owners: Kinetix maintainers
- Related: Training PRD 9.1–9.2; Training design sections 5.1, 5.3, 8.2, 9.1; issue #20

## Context

`CoreProfile` is owned by the Profile module, while `TrainingProfile`,
`TrainingGoal`, and `TrainingInjury` are owned by the Training module. Every
Training-owned root references the active core profile by `profile_id`, and
Training also needs the profile's default time zone and unit preferences.

The architecture (see `docs/ARCHITECTURE.md`) requires modules to communicate
only through their public application interfaces or committed integration
events, and forbids one module from reading another module's tables. A database
foreign key from `training_*` tables to the Profile-owned `profiles` table would
couple Training's schema to Profile's persistence and let Training bypass the
Profile module boundary.

The single-user MVP also must not invent a fake authentication or tenancy model,
so a hard-coded "magic" profile UUID is not acceptable either.

## Decision

Training references the core profile by `profile_id` as a plain indexed column
with **no database foreign key** to `profiles`.

Existence and defaults are obtained through a Profile-owned public port,
`ProfileReader`, exported from the Profile module:

- `getActiveProfile()` — the active `CoreProfileSummary` (throws if none);
- `findActiveProfile()` — the active summary or `null`;
- `requireActiveProfileId()` — the active profile ID for binding references.

Training application commands call `requireActiveProfileId()` when creating a
Training-owned root, and read defaults through `getActiveProfile()`. The Profile
module enforces exactly one active profile at both the application layer and the
database (a partial unique index over the active status), so the ID Training
binds is always the current active profile without a magic constant.

Injury-to-muscle and injury-to-exercise links remain regular foreign keys,
because those target tables (`muscle_groups`, `exercises`) are inside the same
Training schema.

## Consequences

- Training's schema stays decoupled from Profile's; the modules can evolve and
  be tested independently, and cross-module reads go through the public port.
- Referential integrity for `profile_id` is enforced in the application layer
  via `ProfileReader`, not by the database. Because the profile is a single
  active singleton that is never hard-deleted, the risk of a dangling
  `profile_id` is negligible; if profile deletion is ever added, it must publish
  an integration event that Training reacts to.
- `ProfileReader` is the single seam other modules use for profile context,
  keeping the dependency direction Profile → (consumed by) Training explicit.
- Queries that need to join Training rows to profile data must do so through the
  port in application code, not through a SQL join across module tables.
