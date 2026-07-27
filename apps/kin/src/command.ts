import chalk from "chalk";
import { Command } from "commander";

import { parseCliEnv } from "@kinetix/config";
import {
    healthResponseSchema,
    coreProfileResponseSchema,
    createProfileRequestSchema,
    updateProfileRequestSchema,
    createExerciseRequestSchema,
    exerciseCatalogItemSchema,
    exerciseCatalogListResponseSchema,
    exerciseMergeHistoryResponseSchema,
    exerciseMergePreviewResponseSchema,
    exerciseMergeResourceSchema,
    jobResourceSchema,
    replaceExerciseAliasesRequestSchema,
    replaceExerciseMusclesRequestSchema,
    replaceExerciseRelationshipsRequestSchema,
    replaceExerciseTagsRequestSchema,
    restoreRevisionResponseSchema,
    revisionHistoryResponseSchema,
    updateExerciseRequestSchema,
    type JobResource,
} from "@kinetix/types";

import { apiErrorFrom, CliApiError } from "#src/api-error";

interface ProgramDependencies {
    fetch: typeof globalThis.fetch;
    output: (message: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}

const defaults: Required<ProgramDependencies> = {
    fetch: globalThis.fetch,
    output: console.log,
    sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now: Date.now,
};

export function createProgram(dependencies: ProgramDependencies = defaults): Command {
    const sleep = dependencies.sleep ?? defaults.sleep;
    const now = dependencies.now ?? defaults.now;
    const program = new Command();

    program
        .name("kin")
        .description("Command-line interface for Kinetix")
        .version("0.1.0", "-V, --cli-version", "Print the Kinetix CLI version");

    program
        .command("info")
        .description("Print local Kinetix CLI information")
        .action(() => {
            const { KINETIX_API_URL } = parseCliEnv(process.env);
            dependencies.output(chalk.bold("Kinetix"));
            dependencies.output(`API: ${KINETIX_API_URL}`);
        });

    const api = program.command("api").description("Interact with the Kinetix API");

    api.command("status")
        .description("Check API liveness")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .action(async (options: { apiUrl?: string }) => {
            const env = parseCliEnv({
                ...process.env,
                ...(options.apiUrl ? { KINETIX_API_URL: options.apiUrl } : {}),
            });
            const response = await dependencies.fetch(`${env.KINETIX_API_URL}/health`);

            if (!response.ok) throw await apiErrorFrom(response);

            const health = healthResponseSchema.parse(await response.json());
            dependencies.output(`${chalk.green("●")} ${health.service} is ${health.status}`);
        });

    const jobs = program.command("jobs").description("Inspect durable background work");

    jobs.command("status")
        .description("Get a job status, optionally waiting for a terminal result")
        .argument("<job-id>", "Durable job UUID")
        .option("--wait", "Poll until the job succeeds or fails")
        .option("--timeout <seconds>", "Maximum wait time in seconds", parsePositiveNumber, 300)
        .option("--poll-interval <milliseconds>", "Polling interval", parsePositiveInteger, 1_000)
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                jobId: string,
                options: {
                    wait?: boolean;
                    timeout: number;
                    pollInterval: number;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const deadline = now() + options.timeout * 1_000;
                let job: JobResource | null = null;
                while (job === null || (options.wait === true && job.state !== "succeeded" && job.state !== "failed")) {
                    const response = await dependencies.fetch(
                        `${resolveApiUrl(options.apiUrl)}/jobs/${encodeURIComponent(jobId)}`,
                    );
                    if (!response.ok) throw await apiErrorFrom(response);
                    job = jobResourceSchema.parse(await response.json());
                    if (!options.wait || job.state === "succeeded" || job.state === "failed") break;
                    if (now() >= deadline) throw new Error(`Timed out waiting for job ${jobId}`);
                    await sleep(options.pollInterval);
                }

                if (job.state === "failed")
                    throw new CliApiError({
                        code: "JOB_FAILED",
                        message: job.error?.message ?? `Job ${job.id} failed`,
                        correlationId: job.correlationId,
                    });
                if (options.json) dependencies.output(JSON.stringify(job));
                else dependencies.output(formatJob(job));
            },
        );

    registerProfileCommands(program, dependencies);

    const training = program.command("training").description("Manage Training data");
    registerExerciseCommands(training, dependencies);
    const history = training.command("history").description("Inspect and restore aggregate history");

    history
        .command("show")
        .description("List immutable revisions for an aggregate")
        .argument("<entity-type>", "Aggregate entity type")
        .argument("<entity-id>", "Aggregate UUID")
        .option("--limit <count>", "Maximum revisions to return", parsePositiveInteger, 20)
        .option("--before-version <version>", "Return revisions older than this version", parsePositiveInteger)
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                entityType: string,
                entityId: string,
                options: {
                    limit: number;
                    beforeVersion?: number;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const apiUrl = resolveApiUrl(options.apiUrl);
                const query = new URLSearchParams({ limit: String(options.limit) });
                if (options.beforeVersion !== undefined) query.set("beforeVersion", String(options.beforeVersion));
                const response = await dependencies.fetch(
                    `${apiUrl}/history/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?${query}`,
                );
                if (!response.ok) throw await apiErrorFrom(response);
                const result = revisionHistoryResponseSchema.parse(await response.json());
                if (options.json) dependencies.output(JSON.stringify(result));
                else
                    for (const item of result.items)
                        dependencies.output(`${item.version}\t${item.createdAt}\t${item.source}\t${item.summary}`);
            },
        );

    history
        .command("restore")
        .description("Restore an immutable revision as a new aggregate version")
        .argument("<entity-type>", "Aggregate entity type")
        .argument("<entity-id>", "Aggregate UUID")
        .argument("<revision>", "Revision to restore", parsePositiveInteger)
        .requiredOption("--version <version>", "Expected current aggregate version", parsePositiveInteger)
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--reason <reason>", "Human-readable restore reason")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                entityType: string,
                entityId: string,
                revision: number,
                options: {
                    version: number;
                    idempotencyKey?: string;
                    reason?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const headers = new Headers({
                    "content-type": "application/json",
                    "if-match": `"${options.version}"`,
                });
                if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
                const response = await dependencies.fetch(
                    `${resolveApiUrl(options.apiUrl)}/history/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/restore/${revision}`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
                    },
                );
                if (!response.ok) throw await apiErrorFrom(response);
                const result = restoreRevisionResponseSchema.parse(await response.json());
                if (options.json) dependencies.output(JSON.stringify(result));
                else dependencies.output(`Restored ${entityType} ${entityId} at version ${result.version}`);
            },
        );

    return program;
}

function registerProfileCommands(program: Command, dependencies: ProgramDependencies): void {
    const profile = program.command("profile").description("Manage the core profile");

    profile
        .command("show")
        .description("Show the active core profile")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = coreProfileResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/profile`),
            );
            outputProfile(dependencies.output, result, options.json);
        });

    profile
        .command("create")
        .description("Create the single active core profile from inline JSON")
        .requiredOption("--input <json>", "CreateProfileRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createProfileRequestSchema.parse(parseJsonInput(options.input));
            const result = coreProfileResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/profile`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputProfile(dependencies.output, result, options.json);
        });

    profile
        .command("update")
        .description("Update the active core profile from inline JSON")
        .requiredOption("--version <version>", "Expected profile version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateProfileRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                version: number;
                input: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const input = updateProfileRequestSchema.parse(parseJsonInput(options.input));
                const result = coreProfileResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/profile`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputProfile(dependencies.output, result, options.json);
            },
        );
}

function registerExerciseCommands(training: Command, dependencies: ProgramDependencies): void {
    const exercises = training.command("exercises").description("Manage the complete exercise catalog");

    exercises
        .command("list")
        .description("Search and filter exercise definitions")
        .option("--search <text>", "Search exercise names and aliases")
        .option("--status <status>", "Filter active, archived, or all exercises", "active")
        .option("--ownership <ownership>", "Filter seeded or user-owned definitions")
        .option("--limit <count>", "Maximum exercises to return", parsePositiveInteger, 50)
        .option("--cursor <offset>", "Pagination cursor", parseNonNegativeInteger)
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                search?: string;
                status: string;
                ownership?: string;
                limit: number;
                cursor?: number;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const query = new URLSearchParams({ status: options.status, limit: String(options.limit) });
                if (options.search) query.set("search", options.search);
                if (options.ownership) query.set("ownership", options.ownership);
                if (options.cursor !== undefined) query.set("cursor", String(options.cursor));
                const result = exerciseCatalogListResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises?${query}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else
                    for (const exercise of result.items)
                        dependencies.output(
                            `${exercise.id}\t${exercise.version}\t${exercise.status}\t${exercise.name}`,
                        );
            },
        );

    exercises
        .command("show")
        .description("Show one current or archived exercise definition")
        .argument("<exercise-id>", "Exercise UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (exerciseId: string, options: { apiUrl?: string; json?: boolean }) => {
            const exercise = exerciseCatalogItemSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises/${encodeURIComponent(exerciseId)}`,
                ),
            );
            outputExercise(dependencies.output, exercise, options.json);
        });

    exercises
        .command("create")
        .description("Create a user-owned exercise from inline JSON")
        .requiredOption("--input <json>", "CreateExerciseRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createExerciseRequestSchema.parse(parseJsonInput(options.input));
            const exercise = exerciseCatalogItemSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputExercise(dependencies.output, exercise, options.json);
        });

    exercises
        .command("update")
        .description("Version an exercise definition from inline JSON")
        .argument("<exercise-id>", "Exercise UUID")
        .requiredOption("--version <version>", "Expected exercise version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateExerciseRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                exerciseId: string,
                options: {
                    version: number;
                    input: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = updateExerciseRequestSchema.parse(parseJsonInput(options.input));
                const exercise = exerciseCatalogItemSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises/${encodeURIComponent(exerciseId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputExercise(dependencies.output, exercise, options.json);
            },
        );

    for (const action of ["archive", "restore"] as const)
        exercises
            .command(action)
            .description(`${action === "archive" ? "Archive" : "Restore"} an exercise definition`)
            .argument("<exercise-id>", "Exercise UUID")
            .requiredOption("--version <version>", "Expected exercise version", parsePositiveInteger)
            .option("--reason <reason>", "Human-readable mutation reason")
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    exerciseId: string,
                    options: {
                        version: number;
                        reason?: string;
                        idempotencyKey?: string;
                        apiUrl?: string;
                        json?: boolean;
                    },
                ) => {
                    const exercise = exerciseCatalogItemSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises/${encodeURIComponent(exerciseId)}/${action}`,
                            mutationRequest(
                                "POST",
                                options.reason ? { reason: options.reason } : {},
                                options.version,
                                options.idempotencyKey,
                            ),
                        ),
                    );
                    outputExercise(dependencies.output, exercise, options.json);
                },
            );

    exercises
        .command("relationships")
        .description("Replace all exercise relationships from inline JSON")
        .argument("<exercise-id>", "Exercise UUID")
        .requiredOption("--version <version>", "Expected exercise version", parsePositiveInteger)
        .requiredOption("--input <json>", "ReplaceExerciseRelationshipsRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                exerciseId: string,
                options: {
                    version: number;
                    input: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = replaceExerciseRelationshipsRequestSchema.parse(parseJsonInput(options.input));
                const exercise = exerciseCatalogItemSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises/${encodeURIComponent(exerciseId)}/relationships`,
                        mutationRequest("PUT", input, options.version, options.idempotencyKey),
                    ),
                );
                outputExercise(dependencies.output, exercise, options.json);
            },
        );

    for (const collection of [
        {
            name: "aliases",
            description: "Replace all exercise aliases from inline JSON",
            schema: replaceExerciseAliasesRequestSchema,
        },
        {
            name: "muscles",
            description: "Replace all exercise muscle assignments from inline JSON",
            schema: replaceExerciseMusclesRequestSchema,
        },
        {
            name: "tags",
            description: "Replace all exercise tag assignments from inline JSON",
            schema: replaceExerciseTagsRequestSchema,
        },
    ] as const)
        exercises
            .command(collection.name)
            .description(collection.description)
            .argument("<exercise-id>", "Exercise UUID")
            .requiredOption("--version <version>", "Expected exercise version", parsePositiveInteger)
            .requiredOption("--input <json>", `ReplaceExercise${collection.name}Request JSON object`)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    exerciseId: string,
                    options: {
                        version: number;
                        input: string;
                        idempotencyKey?: string;
                        apiUrl?: string;
                        json?: boolean;
                    },
                ) => {
                    const input = collection.schema.parse(parseJsonInput(options.input));
                    const exercise = exerciseCatalogItemSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/catalog/exercises/${encodeURIComponent(exerciseId)}/${collection.name}`,
                            mutationRequest("PUT", input, options.version, options.idempotencyKey),
                        ),
                    );
                    outputExercise(dependencies.output, exercise, options.json);
                },
            );

    exercises
        .command("merge-preview")
        .description("Preview aliases and current-reference impact without changing the catalog")
        .requiredOption("--canonical <exercise-id>", "Canonical exercise UUID")
        .requiredOption("--merged <exercise-id>", "Duplicate exercise UUID")
        .requiredOption("--canonical-version <version>", "Expected canonical version", parsePositiveInteger)
        .requiredOption("--merged-version <version>", "Expected duplicate version", parsePositiveInteger)
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                canonical: string;
                merged: string;
                canonicalVersion: number;
                mergedVersion: number;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const preview = exerciseMergePreviewResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercise-merges/preview`,
                        mutationRequest("POST", mergeInput(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(preview));
                else
                    dependencies.output(
                        `${preview.mergedExercise.name} -> ${preview.canonicalExercise.name}\t${preview.totalReferenceCount} current references\t${preview.redirectedAliases.length} aliases`,
                    );
            },
        );

    exercises
        .command("merge")
        .description("Merge a duplicate exercise into a canonical definition")
        .requiredOption("--canonical <exercise-id>", "Canonical exercise UUID")
        .requiredOption("--merged <exercise-id>", "Duplicate exercise UUID")
        .requiredOption("--canonical-version <version>", "Expected canonical version", parsePositiveInteger)
        .requiredOption("--merged-version <version>", "Expected duplicate version", parsePositiveInteger)
        .requiredOption("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--reason <reason>", "Human-readable merge reason")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                canonical: string;
                merged: string;
                canonicalVersion: number;
                mergedVersion: number;
                idempotencyKey: string;
                reason?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const merge = exerciseMergeResourceSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercise-merges`,
                        mutationRequest(
                            "POST",
                            {
                                ...mergeInput(options),
                                ...(options.reason ? { reason: options.reason } : {}),
                            },
                            undefined,
                            options.idempotencyKey,
                        ),
                    ),
                );
                outputMerge(dependencies.output, merge, options.json);
            },
        );

    exercises
        .command("merge-history")
        .description("List applied and reverted merges for an exercise")
        .argument("<exercise-id>", "Exercise UUID")
        .option("--limit <count>", "Maximum merge records to return", parsePositiveInteger, 20)
        .option("--cursor <offset>", "Pagination cursor", parseNonNegativeInteger)
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                exerciseId: string,
                options: { limit: number; cursor?: number; apiUrl?: string; json?: boolean },
            ) => {
                const query = new URLSearchParams({ limit: String(options.limit) });
                if (options.cursor !== undefined) query.set("cursor", String(options.cursor));
                const history = exerciseMergeHistoryResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercise-merges/history/${encodeURIComponent(exerciseId)}?${query}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(history));
                else
                    for (const merge of history.items)
                        dependencies.output(
                            `${merge.id}\t${merge.version}\t${merge.status}\t${merge.mergedExercise.name} -> ${merge.canonicalExercise.name}`,
                        );
            },
        );

    exercises
        .command("revert-merge")
        .description("Revert an active exercise merge")
        .argument("<merge-id>", "Exercise merge UUID")
        .requiredOption("--merge-version <version>", "Expected merge version", parsePositiveInteger)
        .requiredOption("--canonical-version <version>", "Expected canonical exercise version", parsePositiveInteger)
        .requiredOption("--merged-version <version>", "Expected archived exercise version", parsePositiveInteger)
        .requiredOption("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--reason <reason>", "Human-readable revert reason")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                mergeId: string,
                options: {
                    mergeVersion: number;
                    canonicalVersion: number;
                    mergedVersion: number;
                    idempotencyKey: string;
                    reason?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const merge = exerciseMergeResourceSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/catalog/exercise-merges/${encodeURIComponent(mergeId)}/revert`,
                        mutationRequest(
                            "POST",
                            {
                                expectedCanonicalVersion: options.canonicalVersion,
                                expectedMergedVersion: options.mergedVersion,
                                ...(options.reason ? { reason: options.reason } : {}),
                            },
                            options.mergeVersion,
                            options.idempotencyKey,
                        ),
                    ),
                );
                outputMerge(dependencies.output, merge, options.json);
            },
        );
}

async function responseJson(dependencies: ProgramDependencies, url: string, init?: RequestInit): Promise<unknown> {
    const response = await dependencies.fetch(url, init);
    if (!response.ok) throw await apiErrorFrom(response);
    return response.json();
}

function mutationRequest(
    method: "POST" | "PATCH" | "PUT",
    body: unknown,
    version?: number,
    idempotencyKey?: string,
): RequestInit {
    const headers = new Headers({ "content-type": "application/json" });
    if (version !== undefined) headers.set("if-match", `"${version}"`);
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    return { method, headers, body: JSON.stringify(body) };
}

function mergeInput(options: { canonical: string; merged: string; canonicalVersion: number; mergedVersion: number }) {
    return {
        canonicalExerciseId: options.canonical,
        mergedExerciseId: options.merged,
        expectedCanonicalVersion: options.canonicalVersion,
        expectedMergedVersion: options.mergedVersion,
    };
}

function parseJsonInput(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error("Input must be a valid JSON object");
    }
}

function outputExercise(
    output: (message: string) => void,
    exercise: ReturnType<typeof exerciseCatalogItemSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(exercise));
    else output(`${exercise.id}\t${exercise.version}\t${exercise.status}\t${exercise.name}`);
}

function outputProfile(
    output: (message: string) => void,
    profile: ReturnType<typeof coreProfileResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(profile));
    else output(`${profile.id}\t${profile.version}\t${profile.status}\t${profile.timeZone}`);
}

function outputMerge(
    output: (message: string) => void,
    merge: ReturnType<typeof exerciseMergeResourceSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(merge));
    else
        output(
            `${merge.id}\t${merge.version}\t${merge.status}\t${merge.mergedExercise.name} -> ${merge.canonicalExercise.name}`,
        );
}

function resolveApiUrl(override: string | undefined): string {
    return parseCliEnv({
        ...process.env,
        ...(override ? { KINETIX_API_URL: override } : {}),
    }).KINETIX_API_URL.replace(/\/$/, "");
}

function parsePositiveInteger(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Value must be a positive integer");
    return parsed;
}

function parsePositiveNumber(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Value must be a positive number");
    return parsed;
}

function parseNonNegativeInteger(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Value must be a non-negative integer");
    return parsed;
}

function formatJob(job: JobResource): string {
    const progress = job.progress
        ? ` ${job.progress.completed}${job.progress.total === undefined ? "" : `/${job.progress.total}`}`
        : "";
    return `${job.state}\t${job.id}${progress}`;
}
