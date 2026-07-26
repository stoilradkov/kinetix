# ADR 0004: PostgreSQL jobs and transactional outbox

- Status: Accepted
- Date: 2026-07-26
- Decision owners: Kinetix maintainers
- Related: Training PRD API-4 and AN-8; Training design section 17

## Context

Kinetix needs after-commit reactions and retryable background work for session
completion, analytics invalidation, progression, imports, synchronization, and
scheduled recalculation. These effects must survive API restarts and concurrent
replicas. Publishing directly from domain entities or after a database commit
would either couple the domain to delivery mechanics or leave a failure window
between committing aggregate state and recording the work.

MVP traffic does not justify operating Redis or a message broker. PostgreSQL is
already the authoritative store and provides transactional writes, row locking,
leases, and advisory locks.

## Decision

Use PostgreSQL for both durable jobs and a transactional outbox.

Domain entities raise immutable, versioned facts. They do not publish events,
enqueue jobs, or depend on framework and persistence concepts. Application code
uses capability-shaped `OutboxWriter`, `JobQueue`, handler, lease, clock, and
scheduler-lock ports.

Aggregate state, immutable revisions, and outbox rows are written through the
same application `UnitOfWork`. A successful commit therefore makes both the
authoritative change and its delivery intent visible; a rollback makes neither
visible. Events carry a stable name and version, event ID, occurrence time,
minimal payload, aggregate identity/revision when relevant, and correlation and
causation IDs.

The `jobs` and `outbox_events` tables store state, attempt bounds,
next-attempt time, payload fingerprints, lease owner/expiry, heartbeat, safe
structured error, and timestamps. Jobs additionally store priority, progress,
and an optional type-scoped idempotency key. Public job resources never expose
the stored payload or payload fingerprint.

Workers claim small due batches in transactions using `FOR UPDATE SKIP LOCKED`.
Claiming increments the attempt and installs a time-bounded lease. Only the lease
owner may heartbeat, report progress, complete, or fail the item. Expired leases
are claimable by another worker while attempts remain; an expired final attempt
becomes terminal.

Retries use bounded exponential backoff. Domain and explicitly non-retryable
failures are terminal. Explicit transient failures and unexpected
infrastructure failures retry until the stored attempt bound. Public transient
errors remain generic; full diagnostics stay in worker logs.

Handlers receive the durable item ID as an idempotency key (or a job's explicit
key). Successful handler execution and a handler receipt are committed in one
`UnitOfWork` transaction. Receipts prevent replaying already committed handlers
after a dispatcher crash. External side effects must also use the supplied
idempotency key because PostgreSQL cannot atomically commit a remote system.

Recurring schedulers use transaction-scoped PostgreSQL advisory locks. The lock
and enqueue happen in one transaction so only one API replica creates a given
scheduled occurrence.

Workers initially run in the API process. The same worker host is also available
through `dist/worker.js`, allowing a separate process without moving ports or
handlers. A future broker adapter may replace the PostgreSQL dispatcher without
changing domain code.

## Consequences

- PostgreSQL is the only required durable dependency for MVP background work.
- Aggregate and outbox atomicity is straightforward and testable.
- Multiple API or worker processes can claim work without duplicate concurrent
  ownership.
- Handlers must remain idempotent and keep database effects inside the supplied
  transaction where possible.
- Long handlers must allow heartbeats and use bounded progress updates.
- Polling adds database load, so batch size and polling intervals are
  configurable. A broker remains an operational evolution if scale warrants it.
- Worker diagnostics and sensitive payloads are intentionally absent from
  domain endpoints and public job resources.

## Rejected alternatives

- **Publish after commit in memory:** loses events on crashes and deployment
  restarts.
- **Let repositories publish:** hides transaction orchestration and reverses the
  application/domain dependency direction.
- **Redis or a message broker now:** adds an operational dependency without an
  MVP-scale requirement.
- **Hold row locks while handlers run:** blocks other database work and makes
  crash recovery depend on connection lifetime instead of explicit leases.
