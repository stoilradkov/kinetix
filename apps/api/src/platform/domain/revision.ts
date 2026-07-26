export const revisionSources = ["user", "agent", "import", "sync", "system", "restore"] as const;

export type RevisionSource = (typeof revisionSources)[number];

export function revisionSource(value: string): RevisionSource {
    if (!revisionSources.includes(value as RevisionSource)) throw new Error(`Unknown revision source: ${value}`);
    return value as RevisionSource;
}

export class AggregateVersion {
    private constructor(readonly value: number) {}

    static initial(): AggregateVersion {
        return new AggregateVersion(1);
    }

    static from(value: number): AggregateVersion {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("Aggregate version must be a positive integer");
        return new AggregateVersion(value);
    }

    next(): AggregateVersion {
        return AggregateVersion.from(this.value + 1);
    }

    equals(other: AggregateVersion): boolean {
        return this.value === other.value;
    }
}

export function revisionReason(value: string | null | undefined): string | null {
    if (value == null) return null;
    const reason = value.trim();
    if (reason.length === 0) throw new Error("Revision reason cannot be empty");
    if (reason.length > 500) throw new Error("Revision reason cannot exceed 500 characters");
    return reason;
}
