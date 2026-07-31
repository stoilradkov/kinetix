import chalk from "chalk";
import { Command } from "commander";

import { parseCliEnv } from "@kinetix/config";
import {
    healthResponseSchema,
    coreProfileResponseSchema,
    createProfileRequestSchema,
    updateProfileRequestSchema,
    createTrainingProfileRequestSchema,
    trainingProfileResponseSchema,
    updateTrainingProfileRequestSchema,
    createTrainingGoalRequestSchema,
    trainingGoalListResponseSchema,
    trainingGoalResponseSchema,
    updateTrainingGoalRequestSchema,
    recordTrainingMaxRequestSchema,
    trainingMaxListResponseSchema,
    trainingMaxResponseSchema,
    recordZoneDefinitionRequestSchema,
    zoneDefinitionListResponseSchema,
    zoneDefinitionResponseSchema,
    createEquipmentIncrementRequestSchema,
    updateEquipmentIncrementRequestSchema,
    equipmentIncrementListResponseSchema,
    equipmentIncrementResponseSchema,
    createGearItemRequestSchema,
    updateGearItemRequestSchema,
    gearItemListResponseSchema,
    gearItemResponseSchema,
    createWorkoutTemplateRequestSchema,
    updateWorkoutTemplateRequestSchema,
    workoutTemplateListResponseSchema,
    workoutTemplateResponseSchema,
    createProgramRequestSchema,
    updateProgramRequestSchema,
    activateProgramRequestSchema,
    activateProgramResponseSchema,
    attachProgramSessionRequestSchema,
    programListResponseSchema,
    programResponseSchema,
    programSessionsResponseSchema,
    createPlannedSessionRequestSchema,
    updatePlannedSessionRequestSchema,
    completePlannedSessionRequestSchema,
    skipCancelPlannedSessionRequestSchema,
    plannedSessionListResponseSchema,
    plannedSessionResponseSchema,
    createTrainingInjuryRequestSchema,
    trainingInjuryListResponseSchema,
    trainingInjuryResponseSchema,
    updateTrainingInjuryRequestSchema,
    createManualHealthRecordRequestSchema,
    manualHealthRecordListResponseSchema,
    manualHealthRecordResponseSchema,
    updateManualHealthRecordRequestSchema,
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

    const health = program.command("health").description("Manage Health Data");
    registerHealthRecordCommands(health, dependencies);

    const training = program.command("training").description("Manage Training data");
    registerExerciseCommands(training, dependencies);
    registerTrainingProfileCommands(training, dependencies);
    registerTrainingGoalCommands(training, dependencies);
    registerTrainingMaxCommands(training, dependencies);
    registerZoneCommands(training, dependencies);
    registerEquipmentIncrementCommands(training, dependencies);
    registerGearCommands(training, dependencies);
    registerWorkoutTemplateCommands(training, dependencies);
    registerProgramCommands(training, dependencies);
    registerPlannedSessionCommands(training, dependencies);
    registerTrainingInjuryCommands(training, dependencies);
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

function registerHealthRecordCommands(health: Command, dependencies: ProgramDependencies): void {
    const records = health.command("records").description("Manage manual health records");

    records
        .command("list")
        .description("List manual health records, filtered by type and effective-time window")
        .option("--type <type>", "Filter by body_weight, sleep, resting_heart_rate, or daily_readiness")
        .option("--from <iso>", "Only records at or after this ISO date-time")
        .option("--to <iso>", "Only records at or before this ISO date-time")
        .option("--include-archived", "Include archived records")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                type?: string;
                from?: string;
                to?: string;
                includeArchived?: boolean;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const query = new URLSearchParams();
                if (options.type) query.set("type", options.type);
                if (options.from) query.set("from", options.from);
                if (options.to) query.set("to", options.to);
                if (options.includeArchived) query.set("includeArchived", "true");
                const suffix = query.size > 0 ? `?${query.toString()}` : "";
                const result = manualHealthRecordListResponseSchema.parse(
                    await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/health/records${suffix}`),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const record of result.items) outputHealthRecord(dependencies.output, record, false);
            },
        );

    records
        .command("show")
        .description("Show one manual health record")
        .argument("<record-id>", "Health record UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (recordId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = manualHealthRecordResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/health/records/${encodeURIComponent(recordId)}`,
                ),
            );
            outputHealthRecord(dependencies.output, result, options.json);
        });

    records
        .command("create")
        .description("Record manual health data from inline JSON")
        .requiredOption("--input <json>", "CreateManualHealthRecordRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createManualHealthRecordRequestSchema.parse(parseJsonInput(options.input));
            const result = manualHealthRecordResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/health/records`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputHealthRecord(dependencies.output, result, options.json);
        });

    records
        .command("update")
        .description("Update a manual health record from inline JSON")
        .argument("<record-id>", "Health record UUID")
        .requiredOption("--version <version>", "Expected record version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateManualHealthRecordRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                recordId: string,
                options: {
                    version: number;
                    input: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = updateManualHealthRecordRequestSchema.parse(parseJsonInput(options.input));
                const result = manualHealthRecordResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/health/records/${encodeURIComponent(recordId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputHealthRecord(dependencies.output, result, options.json);
            },
        );

    records
        .command("archive")
        .description("Archive a manual health record")
        .argument("<record-id>", "Health record UUID")
        .requiredOption("--version <version>", "Expected record version", parsePositiveInteger)
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                recordId: string,
                options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const result = manualHealthRecordResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/health/records/${encodeURIComponent(recordId)}/archive`,
                        mutationRequest("POST", {}, options.version, options.idempotencyKey),
                    ),
                );
                outputHealthRecord(dependencies.output, result, options.json);
            },
        );
}

function registerTrainingInjuryCommands(training: Command, dependencies: ProgramDependencies): void {
    const injuries = training.command("injuries").description("Manage training injuries");

    injuries
        .command("list")
        .description("List training injuries, optionally filtered by status")
        .option("--status <status>", "Filter by active, recovering, or resolved")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { status?: string; apiUrl?: string; json?: boolean }) => {
            const query = options.status ? `?status=${encodeURIComponent(options.status)}` : "";
            const result = trainingInjuryListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/injuries${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const injury of result.items) outputInjury(dependencies.output, injury, false);
        });

    injuries
        .command("show")
        .description("Show one training injury")
        .argument("<injury-id>", "Injury UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (injuryId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = trainingInjuryResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/injuries/${encodeURIComponent(injuryId)}`,
                ),
            );
            outputInjury(dependencies.output, result, options.json);
        });

    injuries
        .command("create")
        .description("Create a training injury from inline JSON")
        .requiredOption("--input <json>", "CreateTrainingInjuryRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createTrainingInjuryRequestSchema.parse(parseJsonInput(options.input));
            const result = trainingInjuryResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/injuries`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputInjury(dependencies.output, result, options.json);
        });

    injuries
        .command("update")
        .description("Update a training injury from inline JSON")
        .argument("<injury-id>", "Injury UUID")
        .requiredOption("--version <version>", "Expected injury version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateTrainingInjuryRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                injuryId: string,
                options: {
                    version: number;
                    input: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = updateTrainingInjuryRequestSchema.parse(parseJsonInput(options.input));
                const result = trainingInjuryResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/injuries/${encodeURIComponent(injuryId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputInjury(dependencies.output, result, options.json);
            },
        );
}

function registerTrainingGoalCommands(training: Command, dependencies: ProgramDependencies): void {
    const goals = training.command("goals").description("Manage training goals");

    goals
        .command("list")
        .description("List training goals, optionally filtered by status")
        .option("--status <status>", "Filter by active, achieved, or abandoned")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { status?: string; apiUrl?: string; json?: boolean }) => {
            const query = options.status ? `?status=${encodeURIComponent(options.status)}` : "";
            const result = trainingGoalListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/goals${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const goal of result.items) outputGoal(dependencies.output, goal, false);
        });

    goals
        .command("show")
        .description("Show one training goal")
        .argument("<goal-id>", "Goal UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (goalId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = trainingGoalResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/goals/${encodeURIComponent(goalId)}`,
                ),
            );
            outputGoal(dependencies.output, result, options.json);
        });

    goals
        .command("create")
        .description("Create a training goal from inline JSON")
        .requiredOption("--input <json>", "CreateTrainingGoalRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createTrainingGoalRequestSchema.parse(parseJsonInput(options.input));
            const result = trainingGoalResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/goals`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputGoal(dependencies.output, result, options.json);
        });

    goals
        .command("update")
        .description("Update a training goal from inline JSON")
        .argument("<goal-id>", "Goal UUID")
        .requiredOption("--version <version>", "Expected goal version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateTrainingGoalRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                goalId: string,
                options: {
                    version: number;
                    input: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = updateTrainingGoalRequestSchema.parse(parseJsonInput(options.input));
                const result = trainingGoalResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/goals/${encodeURIComponent(goalId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputGoal(dependencies.output, result, options.json);
            },
        );
}

function registerTrainingMaxCommands(training: Command, dependencies: ProgramDependencies): void {
    const maxes = training.command("maxes").description("Manage exercise training maxima");

    maxes
        .command("list")
        .description("List the current training maxima, optionally filtered by exercise")
        .option("--exercise <exercise-id>", "Filter by exercise UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { exercise?: string; apiUrl?: string; json?: boolean }) => {
            const query = options.exercise ? `?exerciseId=${encodeURIComponent(options.exercise)}` : "";
            const result = trainingMaxListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/maxes${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const max of result.items) outputMax(dependencies.output, max, false);
        });

    maxes
        .command("history")
        .description("List the effective-interval history for one training-max series")
        .requiredOption("--exercise <exercise-id>", "Exercise UUID")
        .requiredOption("--type <type>", "estimated_1rm, training_max, or custom")
        .option("--label <label>", "Custom-max label (required for custom types)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: { exercise: string; type: string; label?: string; apiUrl?: string; json?: boolean }) => {
                const query = new URLSearchParams({ exerciseId: options.exercise, maxType: options.type });
                if (options.label) query.set("customLabel", options.label);
                const result = trainingMaxListResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/maxes/history?${query}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const max of result.items) outputMax(dependencies.output, max, false);
            },
        );

    maxes
        .command("record")
        .description("Record a new training max from inline JSON, closing the current one")
        .requiredOption("--input <json>", "RecordTrainingMaxRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = recordTrainingMaxRequestSchema.parse(parseJsonInput(options.input));
            const result = trainingMaxResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/maxes`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputMax(dependencies.output, result, options.json);
        });
}

function registerZoneCommands(training: Command, dependencies: ProgramDependencies): void {
    const zones = training.command("zones").description("Manage heart-rate, pace, and power zones");

    zones
        .command("list")
        .description("List the current zone definitions across families")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = zoneDefinitionListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/zones`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const zone of result.items) outputZone(dependencies.output, zone, false);
        });

    zones
        .command("history")
        .description("List the effective-interval history for one zone family")
        .requiredOption("--family <family>", "heart_rate, pace, or power")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { family: string; apiUrl?: string; json?: boolean }) => {
            const result = zoneDefinitionListResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/zones/history?family=${encodeURIComponent(options.family)}`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const zone of result.items) outputZone(dependencies.output, zone, false);
        });

    zones
        .command("record")
        .description("Record a new zone definition from inline JSON, closing the current one")
        .requiredOption("--input <json>", "RecordZoneDefinitionRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = recordZoneDefinitionRequestSchema.parse(parseJsonInput(options.input));
            const result = zoneDefinitionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/zones`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputZone(dependencies.output, result, options.json);
        });
}

function registerEquipmentIncrementCommands(training: Command, dependencies: ProgramDependencies): void {
    const increments = training.command("equipment-increments").description("Manage load increments for rounding");

    increments
        .command("list")
        .description("List configured equipment increments")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = equipmentIncrementListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/equipment-increments`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.items) outputIncrement(dependencies.output, item, false);
        });

    increments
        .command("resolve")
        .description("Resolve the most specific increment for an exercise")
        .argument("<exercise-id>", "Exercise UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (exerciseId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = equipmentIncrementResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/equipment-increments/resolve?exerciseId=${encodeURIComponent(exerciseId)}`,
                ),
            );
            outputIncrement(dependencies.output, result, options.json);
        });

    increments
        .command("create")
        .description("Create an equipment increment from inline JSON")
        .requiredOption("--input <json>", "CreateEquipmentIncrementRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createEquipmentIncrementRequestSchema.parse(parseJsonInput(options.input));
            const result = equipmentIncrementResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/equipment-increments`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputIncrement(dependencies.output, result, options.json);
        });

    increments
        .command("update")
        .description("Update an equipment increment from inline JSON")
        .argument("<increment-id>", "Increment UUID")
        .requiredOption("--version <version>", "Expected increment version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateEquipmentIncrementRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                incrementId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = updateEquipmentIncrementRequestSchema.parse(parseJsonInput(options.input));
                const result = equipmentIncrementResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/equipment-increments/${encodeURIComponent(incrementId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputIncrement(dependencies.output, result, options.json);
            },
        );
}

function registerGearCommands(training: Command, dependencies: ProgramDependencies): void {
    const gear = training.command("gear").description("Manage shoes and equipment");

    gear.command("list")
        .description("List gear items, optionally including archived ones")
        .option("--include-archived", "Include archived gear")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { includeArchived?: boolean; apiUrl?: string; json?: boolean }) => {
            const query = options.includeArchived ? "?includeArchived=true" : "";
            const result = gearItemListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/gear${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.items) outputGear(dependencies.output, item, false);
        });

    gear.command("create")
        .description("Create a gear item from inline JSON")
        .requiredOption("--input <json>", "CreateGearItemRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createGearItemRequestSchema.parse(parseJsonInput(options.input));
            const result = gearItemResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/gear`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputGear(dependencies.output, result, options.json);
        });

    gear.command("update")
        .description("Update a gear item from inline JSON")
        .argument("<gear-id>", "Gear UUID")
        .requiredOption("--version <version>", "Expected gear version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateGearItemRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                gearId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = updateGearItemRequestSchema.parse(parseJsonInput(options.input));
                const result = gearItemResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/gear/${encodeURIComponent(gearId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputGear(dependencies.output, result, options.json);
            },
        );

    for (const action of ["archive", "restore"] as const)
        gear.command(action)
            .description(`${action === "archive" ? "Archive" : "Restore"} a gear item`)
            .argument("<gear-id>", "Gear UUID")
            .requiredOption("--version <version>", "Expected gear version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    gearId: string,
                    options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
                ) => {
                    const result = gearItemResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/gear/${encodeURIComponent(gearId)}/${action}`,
                            mutationRequest("POST", {}, options.version, options.idempotencyKey),
                        ),
                    );
                    outputGear(dependencies.output, result, options.json);
                },
            );
}

function registerWorkoutTemplateCommands(training: Command, dependencies: ProgramDependencies): void {
    const templates = training.command("templates").description("Manage reusable workout templates");

    templates
        .command("list")
        .description("List workout templates, optionally including archived ones")
        .option("--include-archived", "Include archived templates")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { includeArchived?: boolean; apiUrl?: string; json?: boolean }) => {
            const query = options.includeArchived ? "?includeArchived=true" : "";
            const result = workoutTemplateListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/templates${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const template of result.items) outputWorkoutTemplate(dependencies.output, template, false);
        });

    templates
        .command("show")
        .description("Show one workout template with its current prescription")
        .argument("<template-id>", "Workout template UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (templateId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = workoutTemplateResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/templates/${encodeURIComponent(templateId)}`,
                ),
            );
            outputWorkoutTemplate(dependencies.output, result, options.json);
        });

    templates
        .command("create")
        .description("Create a workout template from inline JSON")
        .requiredOption("--input <json>", "CreateWorkoutTemplateRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createWorkoutTemplateRequestSchema.parse(parseJsonInput(options.input));
            const result = workoutTemplateResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/templates`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputWorkoutTemplate(dependencies.output, result, options.json);
        });

    templates
        .command("update")
        .description("Update a workout template from inline JSON, republishing its prescription when supplied")
        .argument("<template-id>", "Workout template UUID")
        .requiredOption("--version <version>", "Expected template version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateWorkoutTemplateRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                templateId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = updateWorkoutTemplateRequestSchema.parse(parseJsonInput(options.input));
                const result = workoutTemplateResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/templates/${encodeURIComponent(templateId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputWorkoutTemplate(dependencies.output, result, options.json);
            },
        );

    for (const action of ["archive", "restore"] as const)
        templates
            .command(action)
            .description(`${action === "archive" ? "Archive" : "Restore"} a workout template`)
            .argument("<template-id>", "Workout template UUID")
            .requiredOption("--version <version>", "Expected template version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    templateId: string,
                    options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
                ) => {
                    const result = workoutTemplateResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/templates/${encodeURIComponent(templateId)}/${action}`,
                            mutationRequest("POST", {}, options.version, options.idempotencyKey),
                        ),
                    );
                    outputWorkoutTemplate(dependencies.output, result, options.json);
                },
            );
}

function registerProgramCommands(training: Command, dependencies: ProgramDependencies): void {
    const programs = training.command("programs").description("Manage training programs and nested blocks");

    programs
        .command("list")
        .description("List programs, optionally including archived ones")
        .option("--include-archived", "Include archived programs")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { includeArchived?: boolean; apiUrl?: string; json?: boolean }) => {
            const query = options.includeArchived ? "?includeArchived=true" : "";
            const result = programListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/programs${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const program of result.items) outputProgram(dependencies.output, program, false);
        });

    programs
        .command("show")
        .description("Show one program with its blocks, goal links, and current warnings")
        .argument("<program-id>", "Program UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (programId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = programResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}`,
                ),
            );
            outputProgram(dependencies.output, result, options.json);
        });

    programs
        .command("sessions")
        .description("List the planned sessions that belong to a program")
        .argument("<program-id>", "Program UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (programId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = programSessionsResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}/sessions`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else
                for (const session of result.items)
                    dependencies.output(
                        `${session.plannedSessionId}\t${session.sequence}\t${session.status}\t${session.localDate ?? "-"}\t${session.title ?? ""}`,
                    );
        });

    programs
        .command("create")
        .description("Create a program from inline JSON")
        .requiredOption("--input <json>", "CreateProgramRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createProgramRequestSchema.parse(parseJsonInput(options.input));
            const result = programResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/programs`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputProgram(dependencies.output, result, options.json);
        });

    programs
        .command("update")
        .description("Update a program from inline JSON")
        .argument("<program-id>", "Program UUID")
        .requiredOption("--version <version>", "Expected program version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateProgramRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                programId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = updateProgramRequestSchema.parse(parseJsonInput(options.input));
                const result = programResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputProgram(dependencies.output, result, options.json);
            },
        );

    programs
        .command("activate")
        .description("Activate a program and generate its planned sessions from inline JSON")
        .argument("<program-id>", "Program UUID")
        .requiredOption("--version <version>", "Expected program version", parsePositiveInteger)
        .option("--input <json>", "ActivateProgramRequest JSON object", "{}")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                programId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = activateProgramRequestSchema.parse(parseJsonInput(options.input));
                const result = activateProgramResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}/activate`,
                        mutationRequest("POST", input, options.version, options.idempotencyKey),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else {
                    outputProgram(dependencies.output, result, false);
                    for (const session of result.generatedSessions)
                        outputPlannedSession(dependencies.output, session, false);
                }
            },
        );

    programs
        .command("attach-session")
        .description("Attach an existing planned session to a program from inline JSON")
        .argument("<program-id>", "Program UUID")
        .requiredOption("--input <json>", "AttachProgramSessionRequest JSON object")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (programId: string, options: { input: string; apiUrl?: string; json?: boolean }) => {
            const input = attachProgramSessionRequestSchema.parse(parseJsonInput(options.input));
            const result = programResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}/sessions`,
                    mutationRequest("POST", input, undefined, undefined),
                ),
            );
            outputProgram(dependencies.output, result, options.json);
        });

    for (const action of ["pause", "resume", "complete", "archive", "restore"] as const)
        programs
            .command(action)
            .description(`${capitalizeWord(action)} a program`)
            .argument("<program-id>", "Program UUID")
            .requiredOption("--version <version>", "Expected program version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    programId: string,
                    options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
                ) => {
                    const result = programResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}/${action}`,
                            mutationRequest("POST", {}, options.version, options.idempotencyKey),
                        ),
                    );
                    outputProgram(dependencies.output, result, options.json);
                },
            );
}

function registerPlannedSessionCommands(training: Command, dependencies: ProgramDependencies): void {
    const sessions = training.command("planned-sessions").description("Manage planned training sessions");

    sessions
        .command("list")
        .description("List planned sessions, optionally including archived ones")
        .option("--include-archived", "Include archived sessions")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { includeArchived?: boolean; apiUrl?: string; json?: boolean }) => {
            const query = options.includeArchived ? "?includeArchived=true" : "";
            const result = plannedSessionListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/planned-sessions${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const session of result.items) outputPlannedSession(dependencies.output, session, false);
        });

    sessions
        .command("show")
        .description("Show one planned session with its current prescription")
        .argument("<session-id>", "Planned session UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = plannedSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}`,
                ),
            );
            outputPlannedSession(dependencies.output, result, options.json);
        });

    sessions
        .command("create")
        .description("Create a standalone planned session from inline JSON")
        .requiredOption("--input <json>", "CreatePlannedSessionRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createPlannedSessionRequestSchema.parse(parseJsonInput(options.input));
            const result = plannedSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/planned-sessions`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputPlannedSession(dependencies.output, result, options.json);
        });

    sessions
        .command("update")
        .description("Update a planned session from inline JSON, republishing its prescription when supplied")
        .argument("<session-id>", "Planned session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdatePlannedSessionRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                sessionId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = updatePlannedSessionRequestSchema.parse(parseJsonInput(options.input));
                const result = plannedSessionResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputPlannedSession(dependencies.output, result, options.json);
            },
        );

    sessions
        .command("complete")
        .description("Mark a planned session completed or partially completed")
        .argument("<session-id>", "Planned session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "CompletePlannedSessionRequest JSON object", "{}")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                sessionId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = completePlannedSessionRequestSchema.parse(parseJsonInput(options.input));
                const result = plannedSessionResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}/complete`,
                        mutationRequest("POST", input, options.version, options.idempotencyKey),
                    ),
                );
                outputPlannedSession(dependencies.output, result, options.json);
            },
        );

    for (const action of ["skip", "cancel"] as const)
        sessions
            .command(action)
            .description(`${capitalizeWord(action)} a planned session with an optional structured reason`)
            .argument("<session-id>", "Planned session UUID")
            .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
            .option("--input <json>", "SkipCancelPlannedSessionRequest JSON object", "{}")
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    sessionId: string,
                    options: {
                        version: number;
                        input: string;
                        idempotencyKey?: string;
                        apiUrl?: string;
                        json?: boolean;
                    },
                ) => {
                    const input = skipCancelPlannedSessionRequestSchema.parse(parseJsonInput(options.input));
                    const result = plannedSessionResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}/${action}`,
                            mutationRequest("POST", input, options.version, options.idempotencyKey),
                        ),
                    );
                    outputPlannedSession(dependencies.output, result, options.json);
                },
            );

    for (const action of ["reopen", "archive", "restore"] as const)
        sessions
            .command(action)
            .description(`${capitalizeWord(action)} a planned session`)
            .argument("<session-id>", "Planned session UUID")
            .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    sessionId: string,
                    options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
                ) => {
                    const result = plannedSessionResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}/${action}`,
                            mutationRequest("POST", {}, options.version, options.idempotencyKey),
                        ),
                    );
                    outputPlannedSession(dependencies.output, result, options.json);
                },
            );
}

function registerTrainingProfileCommands(training: Command, dependencies: ProgramDependencies): void {
    const profile = training.command("profile").description("Manage the training profile");

    profile
        .command("show")
        .description("Show the active training profile")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = trainingProfileResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/profile`),
            );
            outputTrainingProfile(dependencies.output, result, options.json);
        });

    profile
        .command("create")
        .description("Create the training profile for the active core profile")
        .requiredOption("--input <json>", "CreateTrainingProfileRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean }) => {
            const input = createTrainingProfileRequestSchema.parse(parseJsonInput(options.input));
            const result = trainingProfileResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/profile`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey),
                ),
            );
            outputTrainingProfile(dependencies.output, result, options.json);
        });

    profile
        .command("update")
        .description("Update the active training profile from inline JSON")
        .requiredOption("--version <version>", "Expected training profile version", parsePositiveInteger)
        .requiredOption("--input <json>", "UpdateTrainingProfileRequest JSON object")
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
                const input = updateTrainingProfileRequestSchema.parse(parseJsonInput(options.input));
                const result = trainingProfileResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/profile`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputTrainingProfile(dependencies.output, result, options.json);
            },
        );
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

function outputTrainingProfile(
    output: (message: string) => void,
    profile: ReturnType<typeof trainingProfileResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(profile));
    else output(`${profile.id}\t${profile.version}\t${profile.status}\t${profile.experience}`);
}

function outputGoal(
    output: (message: string) => void,
    goal: ReturnType<typeof trainingGoalResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(goal));
    else output(`${goal.id}\t${goal.version}\t${goal.status}\t${goal.type}\t${goal.priority}`);
}

function outputMax(
    output: (message: string) => void,
    max: ReturnType<typeof trainingMaxResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(max));
    else {
        const label = max.maxType === "custom" ? `${max.maxType}:${max.customLabel ?? ""}` : max.maxType;
        output(`${max.id}\t${label}\t${max.valueKg}kg\t${max.effectiveFrom}\t${max.effectiveTo ?? "current"}`);
    }
}

function outputZone(
    output: (message: string) => void,
    zone: ReturnType<typeof zoneDefinitionResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(zone));
    else
        output(
            `${zone.id}\t${zone.family}\t${zone.method}\t${zone.ranges.length} ranges\t${zone.effectiveFrom}\t${zone.effectiveTo ?? "current"}`,
        );
}

function outputIncrement(
    output: (message: string) => void,
    increment: ReturnType<typeof equipmentIncrementResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(increment));
    else
        output(
            `${increment.id}\t${increment.version}\t${increment.scope}\t${increment.incrementKg}kg\t${increment.minimumKg ?? "-"}`,
        );
}

function outputGear(
    output: (message: string) => void,
    gear: ReturnType<typeof gearItemResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(gear));
    else output(`${gear.id}\t${gear.version}\t${gear.status}\t${gear.gearType}\t${gear.name}`);
}

function outputWorkoutTemplate(
    output: (message: string) => void,
    template:
        | ReturnType<typeof workoutTemplateResponseSchema.parse>
        | ReturnType<typeof workoutTemplateListResponseSchema.parse>["items"][number],
    json?: boolean,
): void {
    if (json) output(JSON.stringify(template));
    else {
        const activityCount =
            "prescription" in template ? template.prescription.activities.length : template.activities.length;
        output(`${template.id}\t${template.version}\t${template.status}\t${activityCount}\t${template.name}`);
    }
}

function outputProgram(
    output: (message: string) => void,
    program:
        | ReturnType<typeof programResponseSchema.parse>
        | ReturnType<typeof activateProgramResponseSchema.parse>
        | ReturnType<typeof programListResponseSchema.parse>["items"][number],
    json?: boolean,
): void {
    if (json) output(JSON.stringify(program));
    else {
        const blockCount = "blocks" in program ? program.blocks.length : program.blockCount;
        const warningCount = "warnings" in program ? program.warnings.length : 0;
        output(
            `${program.id}\t${program.version}\t${program.status}\t${program.scheduleMode}\t${blockCount}\t${warningCount}\t${program.name}`,
        );
    }
}

function outputPlannedSession(
    output: (message: string) => void,
    session:
        | ReturnType<typeof plannedSessionResponseSchema.parse>
        | ReturnType<typeof plannedSessionListResponseSchema.parse>["items"][number],
    json?: boolean,
): void {
    if (json) output(JSON.stringify(session));
    else
        output(
            `${session.id}\t${session.version}\t${session.status}\t${session.localDate ?? "-"}\t${session.title ?? ""}`,
        );
}

function capitalizeWord(value: string): string {
    return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function outputInjury(
    output: (message: string) => void,
    injury: ReturnType<typeof trainingInjuryResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(injury));
    else output(`${injury.id}\t${injury.version}\t${injury.status}\t${injury.severity}\t${injury.name}`);
}

function outputHealthRecord(
    output: (message: string) => void,
    record: ReturnType<typeof manualHealthRecordResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(record));
    else {
        const archived = record.archivedAt ? "archived" : "active";
        output(`${record.id}\t${record.version}\t${record.type}\t${record.effectiveAt}\t${archived}`);
    }
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
