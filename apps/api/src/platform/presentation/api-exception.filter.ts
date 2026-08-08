import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from "@nestjs/common";

import { apiErrorCodeSchema, apiErrorSchema, type ApiErrorCode } from "@kinetix/types";

import { ApplicationError } from "#src/platform/application/index";
import { DomainError } from "#src/platform/domain/index";
import { correlationIdFrom } from "#src/platform/presentation/api-context.interceptor";
import { formatRevisionEtag } from "#src/platform/presentation/revision-etag";

interface ErrorRequest {
    headers: Record<string, string | string[] | undefined>;
    correlationId?: string;
}

interface ErrorResponse {
    status(status: number): ErrorResponse;
    json(body: unknown): void;
}

interface MappedError {
    status: number;
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    context?: Readonly<Record<string, unknown>>;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(ApiExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<ErrorRequest>();
        const response = http.getResponse<ErrorResponse>();
        const correlationId = request.correlationId ?? correlationIdFrom(request.headers["x-correlation-id"]);
        const mapped = mapException(exception);
        if (mapped.status >= 500)
            this.logger.error(
                `Unhandled request failure correlationId=${correlationId}`,
                exception instanceof Error ? exception.stack : undefined,
            );

        const error = apiErrorSchema.parse({
            ...mapped.context,
            ...versionContext(mapped),
            code: mapped.code,
            message: mapped.message,
            correlationId,
            ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
        });
        response.status(mapped.status).json(error);
    }
}

export function mapException(exception: unknown): MappedError {
    if (exception instanceof ApplicationError || exception instanceof DomainError)
        return {
            status: statusForCode(exception.code),
            code: exception.code,
            message: exception.message,
            ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
            ...(exception.context ? { context: exception.context } : {}),
        };

    if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const raw = exception.getResponse();
        const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        const code = isApiErrorCode(body.code) ? body.code : codeForHttpStatus(status);
        const message = messageFrom(body.message, exception.message);
        const context = Object.fromEntries(
            Object.entries(body).filter(
                ([key]) => !["statusCode", "code", "message", "error", "fieldErrors", "correlationId"].includes(key),
            ),
        );
        return {
            status: code === "VALIDATION_FAILED" ? HttpStatus.UNPROCESSABLE_ENTITY : statusForCode(code, status),
            code,
            message,
            ...(isFieldErrors(body.fieldErrors) ? { fieldErrors: body.fieldErrors } : {}),
            ...(Object.keys(context).length > 0 ? { context } : {}),
        };
    }

    return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
    };
}

function statusForCode(code: string, fallback = HttpStatus.INTERNAL_SERVER_ERROR): number {
    switch (code) {
        case "VALIDATION_FAILED":
        case "CATALOG_MAPPING_REQUIRED":
        case "JOB_FAILED":
            return HttpStatus.UNPROCESSABLE_ENTITY;
        case "PAYLOAD_TOO_LARGE":
            return HttpStatus.PAYLOAD_TOO_LARGE;
        case "NOT_FOUND":
            return HttpStatus.NOT_FOUND;
        case "PRECONDITION_REQUIRED":
            return HttpStatus.PRECONDITION_REQUIRED;
        case "VERSION_CONFLICT":
        case "IDEMPOTENCY_CONFLICT":
        case "IDEMPOTENCY_IN_PROGRESS":
        case "DRY_RUN_EXPIRED":
        case "DRY_RUN_STALE":
        case "DRY_RUN_CONSUMED":
        case "DRY_RUN_TOKEN_INVALID":
        case "EXTERNAL_ID_CONFLICT":
        case "IMPORT_PAYLOAD_CONFLICT":
        case "PROGRESSION_CONFLICT":
        case "PROGRESSION_STALE":
            return HttpStatus.CONFLICT;
        case "INTERNAL_ERROR":
            return HttpStatus.INTERNAL_SERVER_ERROR;
        default:
            return fallback;
    }
}

function codeForHttpStatus(status: number): ApiErrorCode {
    switch (status) {
        case 400:
        case 422:
            return "VALIDATION_FAILED";
        case 404:
            return "NOT_FOUND";
        case 428:
            return "PRECONDITION_REQUIRED";
        default:
            return "INTERNAL_ERROR";
    }
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
    return typeof value === "string" && apiErrorCodeSchema.safeParse(value).success;
}

function messageFrom(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value)) return value.filter(item => typeof item === "string").join("; ") || fallback;
    return fallback || "Request failed";
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
    return (
        typeof value === "object" &&
        value !== null &&
        Object.values(value).every(
            messages => Array.isArray(messages) && messages.every(message => typeof message === "string"),
        )
    );
}

function versionContext(error: MappedError): Record<string, unknown> {
    if (error.code !== "VERSION_CONFLICT") return {};
    const currentVersion = error.context?.currentVersion;
    if (!Number.isSafeInteger(currentVersion) || Number(currentVersion) < 1) return {};
    return { currentVersion, etag: formatRevisionEtag(Number(currentVersion)) };
}
