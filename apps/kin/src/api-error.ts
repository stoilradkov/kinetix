import { apiErrorSchema, type ApiError } from "@kinetix/types";

export class CliApiError extends Error {
    constructor(readonly response: ApiError) {
        super(`${response.code}: ${response.message} (${response.correlationId})`);
        this.name = "CliApiError";
    }
}

export async function apiErrorFrom(response: Response): Promise<CliApiError> {
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) return new CliApiError(parsed.data);
    return new CliApiError({
        code: "INTERNAL_ERROR",
        message: `Kinetix API returned HTTP ${response.status}`,
        correlationId: response.headers.get("x-correlation-id") ?? "unknown",
    });
}

export function cliExitCode(error: unknown): number {
    if (!(error instanceof CliApiError)) return 1;
    switch (error.response.code) {
        case "VALIDATION_FAILED":
        case "CATALOG_MAPPING_REQUIRED":
            return 2;
        case "NOT_FOUND":
            return 3;
        case "PRECONDITION_REQUIRED":
            return 4;
        case "VERSION_CONFLICT":
        case "IDEMPOTENCY_CONFLICT":
        case "IDEMPOTENCY_IN_PROGRESS":
        case "DRY_RUN_EXPIRED":
        case "DRY_RUN_STALE":
        case "PROGRESSION_CONFLICT":
        case "PROGRESSION_STALE":
            return 5;
        case "JOB_FAILED":
            return 6;
        case "INTERNAL_ERROR":
            return 1;
    }
}

export function cliErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown CLI failure";
}
