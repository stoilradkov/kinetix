import { describe, expect, it } from "vitest";

import { analyzeWorkbook } from "#src/analyze";
import { buildHistoricalImportEnvelope, historicalProgramMetadata } from "#src/generate-envelope";
import type { ImportPolicy, TaxonomyCatalogSnapshot, WorkbookSnapshot } from "#src/model";

const policy: ImportPolicy = {
    excludedSheets: new Set(),
    excludedExerciseRules: [],
    assumedBodyweightKg: 74.5,
    timeZone: "Europe/Athens",
    rpeApplication: "all_sets",
};

describe("buildHistoricalImportEnvelope", () => {
    it("uses human-readable names for the historical sheet structures", () => {
        expect(historicalProgramMetadata("Лист1").name).toBe("Full Body 3-Day — Summer 2021");
        expect(historicalProgramMetadata("Лист8").name).toBe("Push/Pull/Legs/Upper/Lower — Spring 2023");
        expect(historicalProgramMetadata("Лист10").name).toBe("Olympic Power + Upper/Lower Hybrid — 2023–2024");
        expect(historicalProgramMetadata("Лист11").name).toBe("Upper/Lower/Upper/Lower/Upper — 2024");
        expect(historicalProgramMetadata("Лист25").name).toBe("Upper/Lower 4-Day — Summer 2026");
        expect(historicalProgramMetadata("Unmapped title")).toEqual({
            name: "Unmapped title",
            rationale: "preserved from the source sheet title",
        });
    });

    it("builds deterministic programs, completed sessions, mappings, and one reusable proposal", () => {
        const snapshot: WorkbookSnapshot = {
            schemaVersion: 1,
            source: { fileName: "fixture.xlsx", sha256: "a".repeat(64) },
            sheets: [
                {
                    name: "Program",
                    values: [
                        ["Meso 1", null, null, null, null, null, null],
                        ["Micro 1", null, null, null, null, null, null],
                        ["Day 1", null, null, null, null, "2025-01-01", null],
                        ["Cable row", "B", 1, 10, null, "40 x 10", 2],
                        ["Day 2", null, null, null, null, "2025-01-08", null],
                        ["Cable row", "B", 1, 10, null, "42.5 x 10", 3],
                    ],
                },
            ],
        };
        const analysis = analyzeWorkbook(snapshot, policy);
        const generated = buildHistoricalImportEnvelope(analysis, {
            exercises: { schemaVersion: 1, items: [] },
            equipment: taxonomy([item("cable", "10000000-0000-4000-8000-000000000001")]),
            movementPatterns: taxonomy([item("horizontal-pull", "10000000-0000-4000-8000-000000000002")]),
            muscles: taxonomy([item("back", "10000000-0000-4000-8000-000000000003")]),
        });

        expect(generated.audit).toMatchObject({
            programs: 1,
            plannedSessions: 2,
            completedSessions: 2,
            exerciseOccurrences: 2,
            performedSets: 2,
            existingCatalogExercises: 0,
            proposedExercises: 1,
        });
        expect(generated.envelope.programs?.[0]?.blocks?.map(block => block.type)).toEqual([
            "macrocycle",
            "mesocycle",
            "microcycle",
        ]);
        expect(generated.envelope.programs?.[0]?.name).toBe("Program");
        expect(generated.envelope.programs?.[0]?.blocks?.[0]?.label).toBe("Program");
        expect(generated.audit.programSummaries).toEqual([
            expect.objectContaining({
                sourceSheet: "Program",
                name: "Program",
                plannedSessions: 2,
                macrocycles: 1,
                mesocycles: 1,
                microcycles: 1,
            }),
        ]);
        expect(generated.envelope.programs?.[0]?.sessions?.[1]).toMatchObject({ relativeWeek: 1, relativeDay: 0 });
        expect(generated.envelope.completedSessions?.[0]?.programMapping?.plannedLink).toEqual({
            programExternalId: "program:Program",
            plannedSessionExternalId: "planned:Program!A3",
        });
        expect(
            generated.envelope.completedSessions?.map(
                session =>
                    session.activities[0]?.type === "strength" &&
                    session.activities[0].strength.occurrences[0]?.proposed?.slug,
            ),
        ).toEqual(["cable-row", "cable-row"]);
        expect(generated.envelope.source.checksum).toMatch(/^[0-9a-f]{64}$/);
    });
});

function taxonomy(items: TaxonomyCatalogSnapshot["items"]): TaxonomyCatalogSnapshot {
    return { schemaVersion: 1, items };
}

function item(slug: string, id: string): TaxonomyCatalogSnapshot["items"][number] {
    return { id, slug, name: slug };
}
