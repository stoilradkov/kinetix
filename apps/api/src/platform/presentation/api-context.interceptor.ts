import { randomUUID } from "node:crypto";

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { tap, type Observable } from "rxjs";

import { formatRevisionEtag } from "#src/platform/presentation/revision-etag";

interface ApiRequest {
    headers: Record<string, string | string[] | undefined>;
    correlationId?: string;
}

interface ApiResponse {
    hasHeader(name: string): boolean;
    setHeader(name: string, value: string): void;
}

@Injectable()
export class ApiContextInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== "http") return next.handle();
        const request = context.switchToHttp().getRequest<ApiRequest>();
        const response = context.switchToHttp().getResponse<ApiResponse>();
        const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
        request.correlationId = correlationId;
        request.headers["x-correlation-id"] = correlationId;
        response.setHeader("X-Correlation-ID", correlationId);

        return next.handle().pipe(
            tap(body => {
                const version = resourceVersion(body);
                if (version !== undefined && !response.hasHeader("ETag"))
                    response.setHeader("ETag", formatRevisionEtag(version));
            }),
        );
    }
}

export function correlationIdFrom(value: string | string[] | undefined): string {
    const candidate = Array.isArray(value) ? value[0] : value;
    const normalized = candidate?.trim();
    if (normalized && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(normalized)) return normalized;
    return randomUUID();
}

function resourceVersion(value: unknown): number | undefined {
    if (typeof value !== "object" || value === null || !("version" in value)) return undefined;
    const version = (value as { version?: unknown }).version;
    return Number.isSafeInteger(version) && Number(version) > 0 ? Number(version) : undefined;
}
