import { AggregateVersion } from "#src/platform/domain/index";

export function formatRevisionEtag(version: number): string {
    return `"${AggregateVersion.from(version).value}"`;
}

export function parseRevisionEtag(value: string): number {
    const match = /^"([1-9]\d*)"$/.exec(value.trim());
    if (!match?.[1]) throw new Error('If-Match must be a quoted positive version, for example "3"');
    return AggregateVersion.from(Number(match[1])).value;
}
