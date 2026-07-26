import { createHash } from "node:crypto";

import { ApplicationValidationError } from "#src/platform/application/errors";

export function canonicalizeRequest(value: unknown): string {
    return canonicalize(value, "$", false, new WeakSet<object>());
}

export function hashRequest(value: unknown): string {
    return createHash("sha256").update(canonicalizeRequest(value)).digest("hex");
}

function canonicalize(value: unknown, path: string, arrayItem: boolean, ancestors: WeakSet<object>): string {
    if (value === null || value === undefined) {
        if (value === undefined && !arrayItem)
            throw new ApplicationValidationError(`Request value at ${path} is not JSON-serializable`);
        return "null";
    }
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new ApplicationValidationError(`Request number at ${path} must be finite`);
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return withAncestor(
            value,
            path,
            ancestors,
            () => `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, true, ancestors)).join(",")}]`,
        );
    if (typeof value !== "object")
        throw new ApplicationValidationError(`Request value at ${path} is not JSON-serializable`);
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new ApplicationValidationError(`Request value at ${path} must be a plain JSON object`);

    const object = value as Record<string, unknown>;
    return withAncestor(object, path, ancestors, () => {
        const entries: string[] = [];
        for (const key of Object.keys(object).sort()) {
            const item = object[key];
            if (item === undefined) continue;
            entries.push(`${JSON.stringify(key)}:${canonicalize(item, `${path}.${key}`, false, ancestors)}`);
        }
        return `{${entries.join(",")}}`;
    });
}

function withAncestor<Result>(value: object, path: string, ancestors: WeakSet<object>, work: () => Result): Result {
    if (ancestors.has(value)) throw new ApplicationValidationError(`Request value at ${path} contains a cycle`);
    ancestors.add(value);
    try {
        return work();
    } finally {
        ancestors.delete(value);
    }
}
