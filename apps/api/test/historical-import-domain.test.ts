import { describe, expect, it } from "vitest";

import { DomainValidationError } from "#src/platform/domain/index";
import {
    HISTORICAL_IMPORT_LIMITS,
    assertReferencesResolve,
    assertUniqueExternalIds,
    assertWithinHistoricalImportLimits,
    validateHistoricalImportIdentities,
    type HistoricalImportInput,
} from "#src/modules/training/domain/index";

/** Assert `fn` throws a DomainValidationError whose flattened field errors contain `substring`. */
function expectFieldError(fn: () => void, substring: string): void {
    try {
        fn();
    } catch (error) {
        expect(error).toBeInstanceOf(DomainValidationError);
        const messages = Object.values((error as DomainValidationError).fieldErrors ?? {}).flat();
        expect(messages.join(" | ")).toContain(substring);
        return;
    }
    throw new Error(`Expected a DomainValidationError containing "${substring}"`);
}

function session(externalId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        externalId,
        activities: [
            {
                externalId: `${externalId}-act-1`,
                strength: {
                    occurrences: [
                        {
                            externalId: `${externalId}-occ-1`,
                            performedSets: [{ externalId: `${externalId}-pset-1` }],
                        },
                    ],
                },
            },
        ],
        ...extra,
    };
}

function payload(overrides: Partial<HistoricalImportInput> = {}): HistoricalImportInput {
    return {
        programs: [
            {
                externalId: "prog-1",
                blocks: [{ externalId: "prog-1-blk-1" }],
                sessions: [
                    {
                        externalId: "prog-1-sess-1",
                        prescription: {
                            activities: [
                                {
                                    externalId: "prog-1-pact-1",
                                    exercises: [
                                        { externalId: "prog-1-pex-1", sets: [{ externalId: "prog-1-pset-1" }] },
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
        ],
        completedSessions: [session("sess-1") as never],
        ...overrides,
    };
}

describe("validateHistoricalImportIdentities", () => {
    it("accepts a well-formed multi-program, multi-session payload", () => {
        expect(() =>
            validateHistoricalImportIdentities(
                payload({ completedSessions: [session("sess-1") as never, session("sess-2") as never] }),
            ),
        ).not.toThrow();
    });

    it("keeps same-day sessions distinct by external id", () => {
        expect(() =>
            validateHistoricalImportIdentities(
                payload({ completedSessions: [session("morning") as never, session("evening") as never] }),
            ),
        ).not.toThrow();
    });
});

describe("assertUniqueExternalIds", () => {
    it("rejects duplicate training-session external ids", () => {
        expect.assertions(2);
        try {
            assertUniqueExternalIds(payload({ completedSessions: [session("dup") as never, session("dup") as never] }));
        } catch (error) {
            expect(error).toBeInstanceOf(DomainValidationError);
            expect((error as DomainValidationError).fieldErrors).toMatchObject({
                "completedSessions.1.externalId": [
                    expect.stringContaining('Duplicate training-session external id "dup"'),
                ],
            });
        }
    });

    it("rejects a duplicate performed-set external id within a session", () => {
        const clash = session("s1") as Record<string, unknown>;
        (clash.activities as Record<string, unknown>[])[0]!.strength = {
            occurrences: [
                { externalId: "s1-occ-1", performedSets: [{ externalId: "set-x" }, { externalId: "set-x" }] },
            ],
        };
        expect(() => assertUniqueExternalIds(payload({ completedSessions: [clash as never] }))).toThrow(
            DomainValidationError,
        );
    });

    it("allows the same external-id string across different entity types", () => {
        // A program-block and a training-session may both be "shared" — different uniqueness namespaces.
        const shared = payload({
            programs: [{ externalId: "shared", blocks: [{ externalId: "shared" }] }],
            completedSessions: [session("shared") as never],
        });
        expect(() => assertUniqueExternalIds(shared)).not.toThrow();
    });
});

describe("assertReferencesResolve", () => {
    it("resolves a valid planned/actual mapping", () => {
        const mapped = session("sess-map", {
            programMapping: {
                plannedLink: { programExternalId: "prog-1", plannedSessionExternalId: "prog-1-sess-1" },
                activities: [
                    {
                        prescribedActivityExternalId: "prog-1-pact-1",
                        actualActivityRef: "sess-map-act-1",
                        relation: "matched",
                    },
                ],
                sets: [{ performedSetRef: "sess-map-pset-1", relation: "added" }],
            },
        });
        expect(() => assertReferencesResolve(payload({ completedSessions: [mapped as never] }))).not.toThrow();
    });

    it("rejects a mapping to an unknown planned session", () => {
        const mapped = session("sess-map", {
            programMapping: { plannedLink: { programExternalId: "prog-1", plannedSessionExternalId: "ghost" } },
        });
        expectFieldError(
            () => assertReferencesResolve(payload({ completedSessions: [mapped as never] })),
            'Unknown planned-session external id "ghost"',
        );
    });

    it("rejects an actual mapping ref that is not in the session tree", () => {
        const mapped = session("sess-map", {
            programMapping: { sets: [{ performedSetRef: "not-here", relation: "added" }] },
        });
        expectFieldError(
            () => assertReferencesResolve(payload({ completedSessions: [mapped as never] })),
            'Unknown performed set ref "not-here"',
        );
    });

    it("rejects a performed set pointing at an unknown set group", () => {
        const bad = session("s1") as Record<string, unknown>;
        (bad.activities as Record<string, unknown>[])[0]!.strength = {
            occurrences: [
                { externalId: "s1-occ-1", performedSets: [{ externalId: "s1-pset-1", setGroupRef: "missing" }] },
            ],
        };
        expectFieldError(
            () => assertReferencesResolve(payload({ completedSessions: [bad as never] })),
            'Unknown set-group ref "missing"',
        );
    });

    it("rejects a pain record targeting an unknown occurrence", () => {
        const bad = session("s1", { painRecords: [{ externalId: "pain-1", occurrenceRef: "ghost" }] });
        expectFieldError(
            () => assertReferencesResolve(payload({ completedSessions: [bad as never] })),
            'Unknown occurrence ref "ghost"',
        );
    });
});

describe("assertWithinHistoricalImportLimits", () => {
    it("rejects too many completed sessions", () => {
        const many = Array.from({ length: HISTORICAL_IMPORT_LIMITS.maxCompletedSessions + 1 }, (_, index) =>
            session(`s-${index}`),
        ) as never[];
        expect(() => assertWithinHistoricalImportLimits({ completedSessions: many })).toThrow(DomainValidationError);
    });

    it("accepts a payload at the activity limit boundary", () => {
        const activities = Array.from({ length: HISTORICAL_IMPORT_LIMITS.maxActivitiesPerSession }, (_, index) => ({
            externalId: `act-${index}`,
            strength: { occurrences: [{ externalId: `occ-${index}`, performedSets: [] }] },
        }));
        expect(() =>
            assertWithinHistoricalImportLimits({ completedSessions: [{ externalId: "s", activities }] }),
        ).not.toThrow();
    });
});
