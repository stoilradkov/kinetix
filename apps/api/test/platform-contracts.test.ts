import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
    ExpectedVersionGuard,
    ExpectedVersionRequiredError,
    hashRequest,
    canonicalizeRequest,
    VersionConflictError,
} from "#src/platform/application/index";
import { ApiContextInterceptor, ApiExceptionFilter } from "#src/platform/presentation/index";

describe("platform command contracts", () => {
    it("canonicalizes object keys before hashing requests", () => {
        expect(canonicalizeRequest({ z: [3, { b: true, a: null }], a: 1 })).toBe('{"a":1,"z":[3,{"a":null,"b":true}]}');
        expect(hashRequest({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
        expect(hashRequest({ b: 2, a: 1 })).toBe(hashRequest({ a: 1, b: 2 }));
    });

    it("requires and compares expected aggregate versions without HTTP semantics", () => {
        const guard = new ExpectedVersionGuard();
        expect(() => guard.verify(undefined, 3)).toThrow(ExpectedVersionRequiredError);
        expect(() => guard.verify(2, 3)).toThrow(VersionConflictError);
        expect(() => guard.verify(3, 3)).not.toThrow();
    });
});

describe("global API presentation", () => {
    it("propagates a correlation ID and emits an ETag for versioned resources", async () => {
        const interceptor = new ApiContextInterceptor();
        const headers = new Map<string, string>();
        const request = { headers: { "x-correlation-id": "cli-request-1" } };
        const response = {
            hasHeader: vi.fn((name: string) => headers.has(name)),
            setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
        };
        const context = {
            getType: () => "http",
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        };

        await firstValueFrom(
            interceptor.intercept(context as never, {
                handle: () => of({ id: "program-1", version: 3 }),
            }),
        );

        expect(request).toMatchObject({ correlationId: "cli-request-1" });
        expect(headers.get("X-Correlation-ID")).toBe("cli-request-1");
        expect(headers.get("ETag")).toBe('"3"');
    });

    it("maps version failures to the stable 409 envelope", () => {
        const filter = new ApiExceptionFilter();
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        const host = {
            switchToHttp: () => ({
                getRequest: () => ({
                    correlationId: "request-2",
                    headers: {},
                }),
                getResponse: () => ({ status, json }),
            }),
        };

        filter.catch(new VersionConflictError(2, 3), host as never);

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith({
            code: "VERSION_CONFLICT",
            message: "Expected aggregate version 2, but current version is 3",
            correlationId: "request-2",
            expectedVersion: 2,
            currentVersion: 3,
            etag: '"3"',
        });
    });
});
