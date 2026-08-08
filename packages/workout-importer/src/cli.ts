import fs from "node:fs/promises";
import path from "node:path";

import { analyzeWorkbook } from "#src/analyze";
import { buildExerciseMappingReview } from "#src/catalog-mapping";
import { buildCanonicalExerciseReview } from "#src/exercise-canonicalization";
import { buildHistoricalImportEnvelope, validateTaxonomySnapshot } from "#src/generate-envelope";
import type { ExerciseCatalogSnapshot, TaxonomyCatalogSnapshot, WorkbookSnapshot } from "#src/model";
import { DEFAULT_IMPORT_POLICY } from "#src/policy";
import { writeAnalysisReports } from "#src/report";

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    if (command === "analyze") return analyze(args);
    if (command === "generate") return generate(args);
    throw new Error("Usage: workout-importer <analyze|generate> [options]");
}

async function analyze(args: readonly string[]): Promise<void> {
    const snapshotPath = option(args, "--snapshot");
    const outputDirectory = option(args, "--output");
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as WorkbookSnapshot;
    const analysis = analyzeWorkbook(snapshot, DEFAULT_IMPORT_POLICY);
    const catalogPath = optionalOption(args, "--catalog");
    const catalog = catalogPath
        ? (JSON.parse(await fs.readFile(catalogPath, "utf8")) as ExerciseCatalogSnapshot)
        : null;
    const performedExercises = analysis.distinctCompletedSessions.flatMap(session => session.performedExercises);
    const mappings = catalog ? buildExerciseMappingReview(performedExercises, catalog) : [];
    const canonicalReview = catalog ? buildCanonicalExerciseReview(performedExercises, catalog) : [];
    await writeAnalysisReports(analysis, outputDirectory, mappings, canonicalReview);
    process.stdout.write(`${JSON.stringify(analysis.summary, null, 2)}\n`);
}

async function generate(args: readonly string[]): Promise<void> {
    const snapshot = await readJson<WorkbookSnapshot>(option(args, "--snapshot"));
    const exercises = await readJson<ExerciseCatalogSnapshot>(option(args, "--catalog"));
    const equipment = await readJson<TaxonomyCatalogSnapshot>(option(args, "--equipment"));
    const movementPatterns = await readJson<TaxonomyCatalogSnapshot>(option(args, "--movement-patterns"));
    const muscles = await readJson<TaxonomyCatalogSnapshot>(option(args, "--muscles"));
    validateTaxonomySnapshot(equipment, "equipment");
    validateTaxonomySnapshot(movementPatterns, "movement-pattern");
    validateTaxonomySnapshot(muscles, "muscle");

    const analysis = analyzeWorkbook(snapshot, DEFAULT_IMPORT_POLICY);
    const namespace = optionalOption(args, "--namespace");
    const generated = buildHistoricalImportEnvelope(
        analysis,
        { exercises, equipment, movementPatterns, muscles },
        namespace ? { namespace } : {},
    );
    const outputDirectory = option(args, "--output");
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(
        path.join(outputDirectory, "historical-import-envelope.json"),
        `${JSON.stringify(generated.envelope, null, 2)}\n`,
        "utf8",
    );
    await fs.writeFile(
        path.join(outputDirectory, "historical-import-audit.json"),
        `${JSON.stringify(generated.audit, null, 2)}\n`,
        "utf8",
    );
    process.stdout.write(`${JSON.stringify(generated.audit, null, 2)}\n`);
}

async function readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function optionalOption(args: readonly string[], name: string): string | null {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? null) : null;
}

function option(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (!value) throw new Error(`Missing required option ${name}`);
    return value;
}

await main();
