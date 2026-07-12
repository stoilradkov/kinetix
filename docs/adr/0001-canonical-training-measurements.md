# ADR 0001: Canonical Training measurements

- Status: Accepted
- Date: 2026-07-12

## Context

Training accepts human-friendly units but analytics, plan comparison, and database queries require one comparable representation. JavaScript binary floating point and PostgreSQL `numeric` drivers have different boundary types. Missing measurements also have different meaning from known zero measurements.

## Decision

The Training domain owns immutable measurement value objects. Their canonical units are kg, metre, millisecond, metre/second, watt, bpm/rpm, and the documented effort/subjective scale. Conversion factors are exact base-10 values represented by `DecimalValue` (a bigint coefficient and decimal scale); PostgreSQL `numeric` values cross adapters as strings and durations as bigints. JSON numbers exist only at validated presentation boundaries.

Each persisted fact promotes its canonical value into a typed relational column. The same row stores a validated `entered_measurements` JSON object containing the caller's unchanged value and unit. Entered JSON supports faithful display and audit, but is never the analytics query surface. Rounding to database scale or display precision is explicit at its boundary and never mutates entered provenance.

Optional values preserve three states: an omitted property means no update, explicit `null` clears a value, and zero is a known zero. Domain/application mapping and persistence mapping must not use truthiness or coalesce missing values to zero.

Factories reject non-finite, negative, out-of-range, invalid-step, reversed-range, and incompatible measurements. Database checks mirror critical non-negative and scale constraints. Assistance load is stored as a positive mass and subtraction belongs to a declared load model.

Conversion is deterministic domain behavior. There is no generic conversion service port, no wire schema dependency in the domain, and no Drizzle row outside infrastructure.

## Consequences

Canonical values are comparable and decimal-safe at persistence boundaries while the exact entered representation remains available. Adapters perform explicit mapping and later feature tables reuse the promoted columns/check policy. Very precise canonical values may require explicit rounding for fixed-scale storage, while their entered value remains lossless.
