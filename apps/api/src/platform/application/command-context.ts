import { ApplicationValidationError } from "#src/platform/application/errors";

export interface CommandContext {
    readonly correlationId: string;
    readonly actorId?: string | null;
    readonly source?: "user" | "agent" | "import" | "sync" | "system" | "restore";
}

export function commandContext(input: CommandContext): CommandContext {
    const correlationId = input.correlationId.trim();
    if (correlationId.length === 0) throw new ApplicationValidationError("Correlation ID cannot be empty");
    if (correlationId.length > 128) throw new ApplicationValidationError("Correlation ID cannot exceed 128 characters");
    return {
        correlationId,
        ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
    };
}
