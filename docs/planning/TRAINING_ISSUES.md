# Training MVP Issue Plan

**Status:** Approved for GitHub creation · **Milestone:** `Training MVP` ·
**Repository:** `stoilradkov/kinetix` · **Last updated:** 2026-07-12

## 1. Source documents

- [Training PRD](../prd/TRAINING.md)
- [Training technical design](../design/TRAINING.md)
- [Kinetix architecture](../ARCHITECTURE.md)

The PRD defines required behavior. The technical design defines the proposed
implementation. GitHub issues are delivery units derived from both documents;
closing every issue is necessary but not sufficient unless the PRD acceptance
suite passes.

## 2. Planning structure

- One milestone: `Training MVP`
- One top-level tracking issue
- Ten slice epics, ordered by dependency
- Forty-one implementation issues sized for focused pull requests
- Epic task lists link the implementation issues
- Issue bodies identify prerequisites, requirements, tests, and exclusions

### GitHub objects

- [Training MVP milestone](https://github.com/stoilradkov/kinetix/milestone/1)
- [Training MVP tracker #1](https://github.com/stoilradkov/kinetix/issues/1)

| Epic key | GitHub epic                                             | Child issue keys and numbers |
| -------- | ------------------------------------------------------- | ---------------------------- |
| E0       | [#2](https://github.com/stoilradkov/kinetix/issues/2)   | F1–F5: #12–#16               |
| E1       | [#3](https://github.com/stoilradkov/kinetix/issues/3)   | P1–P3: #20–#22               |
| E2       | [#4](https://github.com/stoilradkov/kinetix/issues/4)   | C1–C3: #17–#19               |
| E3       | [#5](https://github.com/stoilradkov/kinetix/issues/5)   | PL1–PL6: #23–#28             |
| E4       | [#6](https://github.com/stoilradkov/kinetix/issues/6)   | S1–S5: #29–#33               |
| E5       | [#7](https://github.com/stoilradkov/kinetix/issues/7)   | R1–R3: #34–#36               |
| E6       | [#8](https://github.com/stoilradkov/kinetix/issues/8)   | AD1–AD2: #37–#38             |
| E7       | [#9](https://github.com/stoilradkov/kinetix/issues/9)   | G1–G4: #39–#42               |
| E8       | [#10](https://github.com/stoilradkov/kinetix/issues/10) | A1–A6: #43–#48               |
| E9       | [#11](https://github.com/stoilradkov/kinetix/issues/11) | Q1–Q4: #49–#52               |

## 3. Labels

### Type

- `type: epic`
- `type: feature`
- `type: technical`
- `type: adr`

### Area

- `area: foundation`
- `area: profile`
- `area: catalog`
- `area: planning`
- `area: sessions`
- `area: running`
- `area: adherence`
- `area: progression`
- `area: analytics`
- `area: quality`

### Priority/order

- `priority: p0` — foundation and primary critical path
- `priority: p1` — dependent MVP capabilities
- `priority: p2` — analytics, integration, and release completion

## 4. Epic order

| Key | Epic                                   | Primary dependency             |
| --- | -------------------------------------- | ------------------------------ |
| E0  | Architecture foundations               | None                           |
| E1  | Profile and manual context             | E0; catalog for exercise links |
| E2  | Exercise catalog                       | E0                             |
| E3  | Programs, prescriptions, and bulk JSON | E0, E1, E2                     |
| E4  | Strength session tracking              | E0, E1, E2, E3                 |
| E5  | Manual running and mixed sessions      | E1, E3, E4                     |
| E6  | Planned-versus-actual adherence        | E4, E5                         |
| E7  | Progression engine                     | E1, E3, E6                     |
| E8  | Deterministic analytics                | E4, E5, E6                     |
| E9  | Integration and release readiness      | E0–E8                          |

## 5. Implementation issues

### E0 — Architecture foundations

| Key | Issue                                                                                | Depends on | Requirements/design                         |
| --- | ------------------------------------------------------------------------------------ | ---------- | ------------------------------------------- |
| F1  | Establish module skeleton, schema split, Training instance, and boundary enforcement | —          | Architecture §7–8; Design §4, §7, §23       |
| F2  | Record measurement ADR and implement canonical measurement contracts                 | F1         | PRD UN-1–3, ST-4–7; Design §7, §13, ADR 3   |
| F3  | Record revision ADR and implement snapshot history/restore                           | F1         | PRD PR-6, TS-1, §23; Design §12, ADR 2      |
| F4  | Implement API errors, ETags, optimistic concurrency, and idempotency                 | F1, F3     | PRD API-1–3, BI-6–7; Design §12.3, §18, §20 |
| F5  | Record jobs/outbox ADR and implement PostgreSQL durable work                         | F1         | PRD API-4, AN-8; Design §17, ADR 4          |

### E1 — Profile and manual context

| Key | Issue                                                              | Depends on     | Requirements/design                                 |
| --- | ------------------------------------------------------------------ | -------------- | --------------------------------------------------- |
| P1  | Implement Core/Training profiles, goals, injuries, and limitations | F2, F3, F4, C1 | PRD §9.1–9.2, TS-5–6; Design §5.1, §5.3, §8.2, §9.1 |
| P2  | Implement manual Health Data records and Training read port        | F2, F4, F5     | PRD §9.3, AN-1; Design §5.2, §8.3, §16.3            |
| P3  | Implement training maxima, zones, and gear                         | P1, C2         | PRD ST-5, RN-5–6; Design §9.1, §10.2, §11.3         |

### E2 — Exercise catalog

| Key | Issue                                                                         | Depends on | Requirements/design                 |
| --- | ----------------------------------------------------------------------------- | ---------- | ----------------------------------- |
| C1  | Seed muscle, equipment, movement, tag, and common exercise catalogs           | F1, F2     | PRD EX-1–3; Design §9, §23          |
| C2  | Implement exercise lifecycle, metadata, aliases, relationships, and snapshots | C1, F3, F4 | PRD EX-1–5; Design §5.4, §9.2–9.3   |
| C3  | Implement reversible exercise merge plus catalog web/CLI workflows            | C2         | PRD EX-6, UX-1; Design §9.2, §18–19 |

### E3 — Programs, prescriptions, and bulk JSON

| Key | Issue                                                                          | Depends on  | Requirements/design                           |
| --- | ------------------------------------------------------------------------------ | ----------- | --------------------------------------------- |
| PL1 | Record aggregate ADR and implement immutable prescription schema/lineage       | F2, F3, C2  | PRD PR-4, PR-6, TS-4; Design §5–6, §10, ADR 1 |
| PL2 | Implement mixed workout templates across API, web, and CLI                     | PL1         | PRD PR-4, TS-3; Design §5.5, §10.1–10.3       |
| PL3 | Implement programs, nested blocks, scheduling states, and history              | PL1, P1     | PRD PR-1–3, PR-5–6; Design §5.6–5.7, §10.3    |
| PL4 | Implement activation, generation, rescheduling, and collision/overlap warnings | PL2, PL3    | PRD PR-2, PR-5, AC-1, AC-11; Design §10.3     |
| PL5 | Implement versioned bulk JSON dry-run and exercise mapping                     | PL4, C3, F4 | PRD BI-1–5, AC-2; Design §14.1–14.2           |
| PL6 | Implement atomic idempotent bulk commit and upsert                             | PL5, F5     | PRD BI-6–7, AC-2; Design §14.3                |

### E4 — Strength session tracking

| Key | Issue                                                                              | Depends on     | Requirements/design                                |
| --- | ---------------------------------------------------------------------------------- | -------------- | -------------------------------------------------- |
| S1  | Implement TrainingSession lifecycle, timers, readiness, pain, notes, and tags      | F2, F3, F4, P1 | PRD TS-1–3, TS-5–7; Design §5.8, §11.1, §11.5–11.6 |
| S2  | Implement strength activities, set groups, occurrences, sets, and measurements     | S1, C2         | PRD ST-1–7; Design §11.2, §13                      |
| S3  | Implement planned/actual mappings, target resolution, and mixed-session invariants | S2, PL4, P3    | PRD TS-4, ST-5, AC-3–5; Design §10.2, §11.4, §11.6 |
| S4  | Deliver active workout API and web experience                                      | S3             | PRD UX-3, AC-3–5; Design §18, §26 Slice 4          |
| S5  | Deliver session/set CLI plus reopen, archive, history, and invalidation events     | S3, F5         | PRD §21, §23, AC-12–13; Design §11.6, §17, §19     |

### E5 — Manual running and mixed sessions

| Key | Issue                                                                      | Depends on | Requirements/design                                       |
| --- | -------------------------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| R1  | Implement manual run summary and canonical derived pace                    | S1, F2, P3 | PRD RN-1–2, AC-6; Design §11.3, §16.6                     |
| R2  | Implement run steps, repeats, splits, zones, environment, routes, and gear | R1, PL1    | PRD RN-3–6; Design §10.1–10.2, §11.3                      |
| R3  | Integrate running mappings and deliver mixed-session web/CLI workflows     | R2, S3     | PRD TS-3–4, UX-4, AC-3, AC-6, AC-13; Design §11.4, §18–19 |

### E6 — Planned-versus-actual adherence

| Key | Issue                                                                        | Depends on | Requirements/design                     |
| --- | ---------------------------------------------------------------------------- | ---------- | --------------------------------------- |
| AD1 | Implement mapping-aware adherence components, v1 overall score, and evidence | S3, R3, F5 | PRD AD-1–3, AC-4; Design §16.2, §16.7   |
| AD2 | Expose adherence through API, web, CLI, program, and session views           | AD1        | PRD UX-5, API/CLI, AC-13; Design §18–19 |

### E7 — Progression engine

| Key | Issue                                                                      | Depends on  | Requirements/design                    |
| --- | -------------------------------------------------------------------------- | ----------- | -------------------------------------- |
| G1  | Record progression ADR and implement rule AST, registry, storage, and CRUD | PL1, F4     | PRD PG-1–3; Design §15.1–15.2, ADR 5   |
| G2  | Implement deterministic evaluation, triggers, and persisted explanations   | G1, AD1, F5 | PRD PG-4, PG-7; Design §15.3, §17      |
| G3  | Implement safety policies, contextual checks, and conflict detection       | G2, P2, P3  | PRD PG-5–6; Design §15.3–15.4          |
| G4  | Implement approval/revalidation/atomic application and API/web/CLI queue   | G3, PL4, F3 | PRD PG-5–8, AC-7–8; Design §15, §18–19 |

### E8 — Deterministic analytics

| Key | Issue                                                                                   | Depends on      | Requirements/design                      |
| --- | --------------------------------------------------------------------------------------- | --------------- | ---------------------------------------- |
| A1  | Record analytics ADR and implement projection, invalidation, and rebuild framework      | F5, S5          | PRD AN-1, AN-8; Design §16.1–16.3, ADR 6 |
| A2  | Implement strength volume, muscle, frequency, hard-set, and TUT metrics                 | A1, S2, P2      | PRD AN-2; Design §16.4                   |
| A3  | Implement six 1RM formulas, primary estimate, and personal records                      | A1, S2          | PRD AN-3–4; Design §16.5                 |
| A4  | Implement running trends and multiple activity-load metrics                             | A1, R3          | PRD AN-5; Design §16.6                   |
| A5  | Implement windows, comparisons, findings, feedback, stale state, and recalculation APIs | A2, A3, A4, AD1 | PRD AN-6–10; Design §16.7–16.8, §18      |
| A6  | Deliver analytics web views and CLI commands                                            | A5, AD2         | PRD UX-5, AC-9, AC-13; Design §18–19     |

### E9 — Integration and release readiness

| Key | Issue                                                                              | Depends on              | Requirements/design                |
| --- | ---------------------------------------------------------------------------------- | ----------------------- | ---------------------------------- |
| Q1  | Add architecture-boundary, contract, persistence, migration, and concurrency tests | PL6, S3                 | PRD §25; Design §24                |
| Q2  | Automate all PRD acceptance scenarios end-to-end                                   | S4, S5, R3, AD2, G4, A6 | PRD AC-1–13; Design §24            |
| Q3  | Add Training observability, performance checks, and job diagnostics                | F5, A1, G2              | PRD §25; Design §21, §25           |
| Q4  | Verify API/CLI parity, publish JSON schema, and complete MVP readiness review      | Q1, Q2, Q3              | PRD AC-13, §26–27; Design §26, §29 |

## 6. Engineering issue-body standard

Every implementation issue includes:

- **Context:** why the capability exists, the problem it solves, and the boundary
  it must preserve.
- **Implementation:** concrete responsibilities for domain, application,
  infrastructure, and presentation/contracts, followed by shared architecture
  constraints.
- **Test cases:** issue-specific domain/unit, application, PostgreSQL/integration,
  and contract/end-to-end coverage plus an explicit TDD sequence.

The shared implementation constraints require inward onion dependencies, pure
domain TypeScript, capability-shaped application ports, Drizzle only in
infrastructure, application-owned transactions, explicit mapping between wire/
domain/persistence models, public ports/events for module communication, and
small red-green-refactor increments.

## 7. Definition of done for every issue

- The issue's observable outcome works through its intended public surface.
- New public input/output is validated by Zod and represented in OpenAPI.
- Domain/application code respects module/layer boundaries.
- Database changes include reviewed migrations and integration tests.
- Unit, application, persistence, contract, and/or end-to-end tests identified in
  the issue pass.
- API changes have matching non-interactive CLI support when the issue includes a
  completed public capability.
- User-visible history, idempotency, concurrency, units, and provenance are
  handled where relevant.
- Documentation and ADRs are updated when the implementation changes an approved
  decision.

## 8. Start point

Development begins with E0/F1. F2, F3, and F5 can proceed after the skeleton and
schema boundaries are in place. Catalog seeding (C1) can follow F1/F2, unlocking
the profile exercise links and the prescription model.
