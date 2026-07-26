import { DomainValidationError } from "#src/platform/domain/errors";

export type DomainEventValue =
    string | number | boolean | null | readonly DomainEventValue[] | { readonly [key: string]: DomainEventValue };

export interface DomainEventInput<Payload extends Readonly<Record<string, DomainEventValue>>> {
    id: string;
    name: string;
    version: number;
    occurredAt: Date;
    aggregateType?: string | null;
    aggregateId?: string | null;
    aggregateRevision?: number | null;
    correlationId: string;
    causationId?: string | null;
    payload: Payload;
}

/**
 * An immutable fact raised by domain code. Publishing remains an application
 * concern so aggregates never acquire queue or infrastructure dependencies.
 */
export class DomainEvent<
    Payload extends Readonly<Record<string, DomainEventValue>> = Readonly<Record<string, DomainEventValue>>,
> {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly #occurredAtTimestamp: number;
    readonly aggregateType: string | null;
    readonly aggregateId: string | null;
    readonly aggregateRevision: number | null;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly payload: Payload;

    constructor(input: DomainEventInput<Payload>) {
        this.id = required(input.id, "Event ID", 128);
        this.name = eventName(input.name);
        this.version = positiveInteger(input.version, "Event version");
        this.#occurredAtTimestamp = validDate(input.occurredAt, "Event occurrence time").getTime();
        this.aggregateType = optional(input.aggregateType, "Aggregate type", 120);
        this.aggregateId = optional(input.aggregateId, "Aggregate ID", 128);
        this.aggregateRevision =
            input.aggregateRevision === undefined || input.aggregateRevision === null
                ? null
                : positiveInteger(input.aggregateRevision, "Aggregate revision");
        this.correlationId = required(input.correlationId, "Correlation ID", 128);
        this.causationId = optional(input.causationId, "Causation ID", 128);
        this.payload = immutableCopy(input.payload);

        Object.freeze(this);
    }

    get stableName(): string {
        return `${this.name}.v${this.version}`;
    }

    get occurredAt(): Date {
        return new Date(this.#occurredAtTimestamp);
    }
}

function eventName(value: string): string {
    const normalized = required(value, "Event name", 180);
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(normalized))
        throw new DomainValidationError(
            "Event name must be a lowercase dotted name such as training.session.completed",
        );
    return normalized;
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new DomainValidationError(`${name} must be a positive integer`);
    return value;
}

function validDate(value: Date, name: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new DomainValidationError(`${name} must be a valid date`);
    return Object.freeze(new Date(value.getTime()));
}

function required(value: string, name: string, maximumLength: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new DomainValidationError(`${name} cannot be empty`);
    if (normalized.length > maximumLength)
        throw new DomainValidationError(`${name} cannot exceed ${maximumLength} characters`);
    return normalized;
}

function optional(value: string | null | undefined, name: string, maximumLength: number): string | null {
    if (value === undefined || value === null) return null;
    return required(value, name, maximumLength);
}

function immutableCopy<Value>(value: Value): Value {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
    if (typeof value !== "object" || value === null) return value;
    for (const item of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(item);
    return Object.freeze(value);
}
