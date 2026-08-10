import { readFileSync } from "node:fs";

import chalk from "chalk";
import { Command } from "commander";

import { parseCliEnv } from "@kinetix/config";
import {
    bulkCommitRequestSchema,
    bulkCommitResponseSchema,
    bulkDryRunResponseSchema,
    bulkProgramEnvelopeSchema,
    historicalImportCommitRequestSchema,
    historicalImportCommitResponseSchema,
    type HistoricalImportCommitResponse,
    historicalImportDryRunResponseSchema,
    historicalImportEnvelopeSchema,
    historicalImportListResponseSchema,
    historicalImportReportResponseSchema,
    type HistoricalImportReportResponse,
    historicalImportRevertResponseSchema,
    type HistoricalImportRevertResponse,
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
    createProgressionRuleRequestSchema,
    updateProgressionRuleRequestSchema,
    progressionRuleListResponseSchema,
    progressionRuleResponseSchema,
    progressionEvaluationListResponseSchema,
    progressionEvaluationResponseSchema,
    createProgramRequestSchema,
    updateProgramRequestSchema,
    activateProgramRequestSchema,
    activateProgramResponseSchema,
    attachProgramSessionRequestSchema,
    changeProgramStartDateRequestSchema,
    changeProgramStartDateResponseSchema,
    programListResponseSchema,
    programResponseSchema,
    programSessionsResponseSchema,
    createPlannedSessionRequestSchema,
    updatePlannedSessionRequestSchema,
    completePlannedSessionRequestSchema,
    reschedulePlannedSessionRequestSchema,
    skipCancelPlannedSessionRequestSchema,
    plannedSessionListResponseSchema,
    plannedSessionResponseSchema,
    createTrainingSessionRequestSchema,
    updateTrainingSessionRequestSchema,
    completeTrainingSessionRequestSchema,
    startPlannedTrainingSessionRequestSchema,
    startEmptyTrainingSessionRequestSchema,
    startTemplateTrainingSessionRequestSchema,
    startPreviousTrainingSessionRequestSchema,
    addSessionActivityRequestSchema,
    recordPerformedSetRequestSchema,
    updatePerformedSetRequestSchema,
    setRunningActivityRequestSchema,
    runningActivitySummaryResponseSchema,
    addRunRequestSchema,
    updateRunRequestSchema,
    runViewResponseSchema,
    runListResponseSchema,
    recordSessionMappingsRequestSchema,
    activeTrainingSessionResponseSchema,
    completionPreviewResponseSchema,
    adherenceFormulaResponseSchema,
    adherenceQueryResponseSchema,
    sessionAdherenceResponseSchema,
    findingQueryResponseSchema,
    metricCalculatorCatalogResponseSchema,
    metricQueryResponseSchema,
    personalRecordCatalogResponseSchema,
    metricRebuildResponseSchema,
    trainingSessionListResponseSchema,
    trainingSessionResponseSchema,
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
    registerImportCommands(training, dependencies);
    registerPlannedSessionCommands(training, dependencies);
    registerTrainingSessionCommands(training, dependencies);
    registerTrainingSetCommands(training, dependencies);
    registerTrainingRunningCommands(training, dependencies);
    registerTrainingInjuryCommands(training, dependencies);
    registerTrainingAdherenceCommands(training, dependencies);
    registerTrainingAnalyticsCommands(training, dependencies);
    registerTrainingProgressionCommands(training, dependencies);
    registerProgressionRuleCommands(training, dependencies);
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

    // Top-level `kin run` alias over the Training run contracts (design §19; PRD R3).
    registerRunCommands(program, dependencies);

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

function registerProgressionRuleCommands(training: Command, dependencies: ProgramDependencies): void {
    const rules = training.command("rules").description("Manage bounded, versioned progression rules");

    rules
        .command("list")
        .description("List progression rules, optionally filtered by scope, enabled, and archive state")
        .option("--include-archived", "Include archived rules")
        .option("--scope-type <type>", "Filter by scope type (program|block|template|exercise|set)")
        .option("--enabled <boolean>", "Filter by enabled flag (true|false)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                includeArchived?: boolean;
                scopeType?: string;
                enabled?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const params = new URLSearchParams();
                if (options.includeArchived) params.set("includeArchived", "true");
                if (options.scopeType !== undefined) params.set("scopeType", options.scopeType);
                if (options.enabled !== undefined) params.set("enabled", options.enabled);
                const query = params.toString() ? `?${params.toString()}` : "";
                const result = progressionRuleListResponseSchema.parse(
                    await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/rules${query}`),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const rule of result.items) outputProgressionRule(dependencies.output, rule, false);
            },
        );

    rules
        .command("show")
        .description("Show one progression rule with its condition tree and actions")
        .argument("<rule-id>", "Progression rule UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (ruleId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = progressionRuleResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/rules/${encodeURIComponent(ruleId)}`,
                ),
            );
            outputProgressionRule(dependencies.output, result, options.json);
        });

    rules
        .command("create")
        .description("Create a progression rule from inline JSON, stdin, or a file")
        .option("--input <json>", "CreateProgressionRuleRequest JSON object")
        .option("--file <path>", "Read the JSON body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                input?: string;
                file?: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const input = createProgressionRuleRequestSchema.parse(readJsonBody(options));
                const result = progressionRuleResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/rules`,
                        mutationRequest("POST", input, undefined, options.idempotencyKey),
                    ),
                );
                outputProgressionRule(dependencies.output, result, options.json);
            },
        );

    rules
        .command("update")
        .description("Update a progression rule from inline JSON, stdin, or a file")
        .argument("<rule-id>", "Progression rule UUID")
        .requiredOption("--version <version>", "Expected rule version", parsePositiveInteger)
        .option("--input <json>", "UpdateProgressionRuleRequest JSON object")
        .option("--file <path>", "Read the JSON body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                ruleId: string,
                options: {
                    version: number;
                    input?: string;
                    file?: string;
                    idempotencyKey?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const input = updateProgressionRuleRequestSchema.parse(readJsonBody(options));
                const result = progressionRuleResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/rules/${encodeURIComponent(ruleId)}`,
                        mutationRequest("PATCH", input, options.version, options.idempotencyKey),
                    ),
                );
                outputProgressionRule(dependencies.output, result, options.json);
            },
        );

    for (const action of ["archive", "restore"] as const)
        rules
            .command(action)
            .description(`${action === "archive" ? "Archive" : "Restore"} a progression rule`)
            .argument("<rule-id>", "Progression rule UUID")
            .requiredOption("--version <version>", "Expected rule version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(
                async (
                    ruleId: string,
                    options: { version: number; idempotencyKey?: string; apiUrl?: string; json?: boolean },
                ) => {
                    const result = progressionRuleResponseSchema.parse(
                        await responseJson(
                            dependencies,
                            `${resolveApiUrl(options.apiUrl)}/training/rules/${encodeURIComponent(ruleId)}/${action}`,
                            mutationRequest("POST", {}, options.version, options.idempotencyKey),
                        ),
                    );
                    outputProgressionRule(dependencies.output, result, options.json);
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
                        `${session.plannedSessionId}\t${session.sequence}\t${session.status}\t${session.localDate ?? "-"}\t${session.actualSessionId ?? "-"}\t${session.title ?? ""}`,
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
        .command("dry-run")
        .description("Validate and preview a complete bulk program (versioned JSON) without side effects")
        .option("--file <path>", "Path to a BulkProgramEnvelope JSON file ('-' reads stdin)")
        .option("--input <json>", "Inline BulkProgramEnvelope JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                file?: string;
                input?: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const envelope = bulkProgramEnvelopeSchema.parse(readEnvelopeInput(options));
                const result = bulkDryRunResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/bulk/programs/dry-runs`,
                        mutationRequest("POST", envelope, undefined, options.idempotencyKey),
                    ),
                );
                if (options.json) {
                    dependencies.output(JSON.stringify(result));
                    return;
                }
                dependencies.output(
                    `${result.dryRunId}\t${result.state}\tsessions=${result.generatedSessionCount}\texpires=${result.expiresAt}`,
                );
                dependencies.output(`token\t${result.approvalToken}\thash\t${result.referenceHash}`);
                for (const warning of result.warnings)
                    dependencies.output(`warning\t${warning.code}\t${warning.message}`);
                for (const mapping of result.mappings)
                    dependencies.output(
                        `mapping\t${mapping.status}\t${mapping.sessionExternalId}\t${mapping.exerciseRef}`,
                    );
                for (const error of result.errors)
                    dependencies.output(`error\t${error.code}\t${error.path.join(".")}\t${error.message}`);
                for (const proposed of result.proposedExercises)
                    dependencies.output(`proposed\t${proposed.exerciseRef}\t${proposed.definition.name}`);
            },
        );

    programs
        .command("commit")
        .description("Commit an approved bulk dry-run into authoritative Training state (no replacement body)")
        .requiredOption("--dry-run-id <id>", "The dry-run UUID returned by 'programs dry-run'")
        .requiredOption("--approval-token <token>", "The approval token returned by 'programs dry-run'")
        .option("--idempotency-key <key>", "Stable key for safely retrying this commit")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                dryRunId: string;
                approvalToken: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const request = bulkCommitRequestSchema.parse({
                    dryRunId: options.dryRunId,
                    approvalToken: options.approvalToken,
                });
                const result = bulkCommitResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/bulk/programs/commits`,
                        mutationRequest("POST", request, undefined, options.idempotencyKey),
                    ),
                );
                if (options.json) {
                    dependencies.output(JSON.stringify(result));
                    return;
                }
                dependencies.output(
                    `${result.programId}\tv${result.programVersion}\tsessions=${result.sessions.length}\tmode=${result.mode}`,
                );
                for (const exercise of result.createdExercises)
                    dependencies.output(`created-exercise\t${exercise.exerciseRef}\t${exercise.exerciseId}`);
                for (const warning of result.warnings)
                    dependencies.output(`warning\t${warning.code}\t${warning.message}`);
            },
        );

    programs
        .command("change-start-date")
        .description("Change a program's start date, sliding only incomplete future sessions")
        .argument("<program-id>", "Program UUID")
        .requiredOption("--version <version>", "Expected program version", parsePositiveInteger)
        .requiredOption("--input <json>", "ChangeProgramStartDateRequest JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                programId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = changeProgramStartDateRequestSchema.parse(parseJsonInput(options.input));
                const result = changeProgramStartDateResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/programs/${encodeURIComponent(programId)}/change-start-date`,
                        mutationRequest("POST", input, options.version, options.idempotencyKey),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else {
                    outputProgram(dependencies.output, result, false);
                    for (const moved of result.movedSessions)
                        dependencies.output(`moved\t${moved.id}\t${moved.fromDate}\t→\t${moved.toDate}`);
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

function registerImportCommands(training: Command, dependencies: ProgramDependencies): void {
    const imports = training.command("imports").description("Preview and manage normalized historical imports");

    imports
        .command("dry-run")
        .description("Validate and preview an already-normalized historical import (many programs + sessions)")
        .option("--file <path>", "Path to a HistoricalImportEnvelope JSON file ('-' reads stdin)")
        .option("--input <json>", "Inline HistoricalImportEnvelope JSON object")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                file?: string;
                input?: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const envelope = historicalImportEnvelopeSchema.parse(readEnvelopeInput(options));
                const result = historicalImportDryRunResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/imports/dry-runs`,
                        mutationRequest("POST", envelope, undefined, options.idempotencyKey),
                    ),
                );
                if (options.json) {
                    dependencies.output(JSON.stringify(result));
                    return;
                }
                const counts = result.storagePlan.counts;
                dependencies.output(
                    `${result.dryRunId}\t${result.state}\tprograms=${result.summary.programs}\tsessions=${result.summary.completedSessions}\texpires=${result.expiresAt}`,
                );
                dependencies.output(`token\t${result.approvalToken}\thash\t${result.referenceHash}`);
                dependencies.output(
                    `storage\tcreate=${counts.create}\tupdate=${counts.update}\tskip=${counts["skip-identical"]}\tconflict=${counts.conflict}`,
                );
                for (const conflict of result.storagePlan.conflicts)
                    dependencies.output(
                        `conflict\t${conflict.entityType}\t${conflict.externalId}\t${conflict.conflictCode ?? ""}`,
                    );
                for (const warning of result.warnings)
                    dependencies.output(`warning\t${warning.code}\t${warning.message}`);
                for (const mapping of result.mappings)
                    dependencies.output(
                        `mapping\t${mapping.status}\t${mapping.sessionExternalId}\t${mapping.exerciseRef}`,
                    );
                for (const error of result.errors)
                    dependencies.output(`error\t${error.code}\t${error.path.join(".")}\t${error.message}`);
            },
        );

    imports
        .command("commit")
        .description("Commit an approved historical dry-run into authoritative Training state")
        .requiredOption("--dry-run-id <id>", "The dry-run to commit")
        .requiredOption("--approval-token <token>", "The approval token returned by the dry-run")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                dryRunId: string;
                approvalToken: string;
                idempotencyKey?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const request = historicalImportCommitRequestSchema.parse({
                    dryRunId: options.dryRunId,
                    approvalToken: options.approvalToken,
                });
                const result = historicalImportCommitResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/imports/commits`,
                        mutationRequest("POST", request, undefined, options.idempotencyKey),
                    ),
                );
                printCommitResult(dependencies, result, options.json);
            },
        );

    imports
        .command("status")
        .description("Read the status and result of a historical import commit run")
        .requiredOption("--id <id>", "The commit run id")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportCommitResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}`,
                ),
            );
            printCommitResult(dependencies, result, options.json);
        });

    imports
        .command("show")
        .description("Show one historical import commit run and its committed entities")
        .requiredOption("--id <id>", "The commit run id")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportCommitResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}`,
                ),
            );
            printCommitResult(dependencies, result, options.json);
        });

    imports
        .command("list")
        .description("List the active profile's historical imports, newest first")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = historicalImportListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/imports/commits`),
            );
            if (options.json) {
                dependencies.output(JSON.stringify(result));
                return;
            }
            dependencies.output(`imports\t${result.count}`);
            for (const item of result.items)
                dependencies.output(
                    `${item.commitId}\t${item.state}${item.reverted ? " (reverted)" : ""}\tprograms=${item.programs}\tsessions=${item.completedSessions}\tcreated=${item.createdAt}`,
                );
        });

    imports
        .command("report")
        .description("Generate the immutable storage audit for a committed historical import")
        .requiredOption("--id <id>", "The commit run id")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportReportResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}/report`,
                ),
            );
            printReportResult(dependencies, result, options.json);
        });

    imports
        .command("revert")
        .description("Revert a committed historical import through scoped, history-preserving archival")
        .requiredOption("--id <id>", "The commit run id to revert")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportRevertResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}/reverts`,
                    mutationRequest("POST", {}, undefined, undefined),
                ),
            );
            printRevertResult(dependencies, result, options.json);
        });

    imports
        .command("revert-status")
        .description("Read the status and result of a historical import revert run")
        .requiredOption("--id <id>", "The commit run id")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportRevertResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}/reverts`,
                ),
            );
            printRevertResult(dependencies, result, options.json);
        });

    imports
        .command("retry")
        .description("Resume a failed or interrupted historical import commit from its checkpoint")
        .requiredOption("--id <id>", "The commit run id")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { id: string; apiUrl?: string; json?: boolean }) => {
            const result = historicalImportCommitResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/imports/commits/${encodeURIComponent(options.id)}/retries`,
                    mutationRequest("POST", {}, undefined, undefined),
                ),
            );
            printCommitResult(dependencies, result, options.json);
        });
}

function printReportResult(
    dependencies: ProgramDependencies,
    result: HistoricalImportReportResponse,
    json: boolean | undefined,
): void {
    if (json) {
        dependencies.output(JSON.stringify(result));
        return;
    }
    const counts = result.counts;
    dependencies.output(
        `${result.commitId}\t${result.state}\tprograms=${result.programs}\tsessions=${result.completedSessions}`,
    );
    dependencies.output(`payload\t${result.source.namespace}\t${result.payloadId}\tchecksum=${result.checksum}`);
    dependencies.output(
        `counts\tcreated=${counts.created}\tupdated=${counts.updated}\tskipped=${counts.skipped}\tconflicted=${counts.conflicted}`,
    );
    for (const entity of result.entities)
        dependencies.output(
            `entity\t${entity.entityType}\t${entity.externalId}\t${entity.entityId}\tversion=${entity.currentVersion ?? "-"}${entity.archived ? "\tarchived" : ""}`,
        );
    for (const warning of result.warnings) dependencies.output(`warning\t${warning.code}\t${warning.message}`);
    if (result.failure)
        dependencies.output(
            `failure\t${result.failure.code}\t${result.failure.path.join(".")}\t${result.failure.message}`,
        );
    if (result.revert)
        dependencies.output(
            `revert\t${result.revert.state}\tarchived=${result.revert.archived}\tblocked=${result.revert.blocked}`,
        );
}

function printRevertResult(
    dependencies: ProgramDependencies,
    result: HistoricalImportRevertResponse,
    json: boolean | undefined,
): void {
    if (json) {
        dependencies.output(JSON.stringify(result));
        return;
    }
    const counts = result.counts;
    dependencies.output(`${result.revertId}\t${result.state}\tcommit=${result.commitId}`);
    dependencies.output(`counts\tarchived=${counts.archived}\tblocked=${counts.blocked}\tskipped=${counts.skipped}`);
    for (const entity of result.archivedEntities)
        dependencies.output(`archived\t${entity.entityType}\t${entity.externalId}\t${entity.entityId}`);
    for (const entity of result.blockedEntities)
        dependencies.output(
            `blocked\t${entity.entityType}\t${entity.externalId}\t${entity.entityId}\t${entity.reason}`,
        );
    if (result.failure)
        dependencies.output(
            `failure\t${result.failure.code}\t${result.failure.path.join(".")}\t${result.failure.message}`,
        );
}

function printCommitResult(
    dependencies: ProgramDependencies,
    result: HistoricalImportCommitResponse,
    json: boolean | undefined,
): void {
    if (json) {
        dependencies.output(JSON.stringify(result));
        return;
    }
    const counts = result.counts;
    dependencies.output(
        `${result.commitId}\t${result.state}\tprograms=${result.programs}\tsessions=${result.completedSessions}`,
    );
    dependencies.output(
        `counts\tcreated=${counts.created}\tupdated=${counts.updated}\tskipped=${counts.skipped}\tconflicted=${counts.conflicted}`,
    );
    for (const entity of result.entities)
        dependencies.output(`entity\t${entity.entityType}\t${entity.externalId}\t${entity.entityId}`);
    for (const exercise of result.createdExercises)
        dependencies.output(`exercise\t${exercise.exerciseId}\t${exercise.exerciseRef}`);
    if (result.failure)
        dependencies.output(
            `failure\t${result.failure.code}\t${result.failure.path.join(".")}\t${result.failure.message}`,
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

    sessions
        .command("reschedule")
        .description("Reschedule an open planned session to a new date/time from inline JSON")
        .argument("<session-id>", "Planned session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "ReschedulePlannedSessionRequest JSON object", "{}")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                sessionId: string,
                options: { version: number; input: string; idempotencyKey?: string; apiUrl?: string; json?: boolean },
            ) => {
                const input = reschedulePlannedSessionRequestSchema.parse(parseJsonInput(options.input));
                const result = plannedSessionResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/planned-sessions/${encodeURIComponent(sessionId)}/reschedule`,
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

function registerTrainingProgressionCommands(training: Command, dependencies: ProgramDependencies): void {
    const progression = training
        .command("progression")
        .description("Evaluate progression rules and inspect deterministic evaluation evidence");

    progression
        .command("evaluate")
        .description("Manually (or scheduled-) evaluate a completed session's applicable rules")
        .argument("<session-id>", "Training session UUID")
        .option("--trigger <trigger>", "Trigger to resolve rules for (manual|scheduled)", "manual")
        .option("--rule <id>", "Restrict evaluation to a single rule UUID")
        .option("--source <source>", "Provenance source recorded with the evaluation")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                sessionId: string,
                options: { trigger?: string; rule?: string; source?: string; apiUrl?: string; json?: boolean },
            ) => {
                const body: Record<string, unknown> = { trigger: options.trigger ?? "manual" };
                if (options.rule !== undefined) body.ruleId = options.rule;
                const result = progressionEvaluationListResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/progression/evaluate`,
                        mutationRequest("POST", body, undefined, undefined, provenanceOf(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const item of result.items) outputProgressionEvaluation(dependencies.output, item);
            },
        );

    progression
        .command("session")
        .description("List the progression evaluations recorded for one session")
        .argument("<session-id>", "Training session UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = progressionEvaluationListResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/progression/evaluations`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.items) outputProgressionEvaluation(dependencies.output, item);
        });

    progression
        .command("list")
        .description("List progression evaluations across the profile (approval queue)")
        .option("--status <status>", "Filter by status (unmatched|pending|blocked|applied|rejected)")
        .option("--rule <id>", "Filter by rule UUID")
        .option("--limit <count>", "Maximum results (1-200)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: { status?: string; rule?: string; limit?: string; apiUrl?: string; json?: boolean }) => {
                const params = new URLSearchParams();
                if (options.status !== undefined) params.set("status", options.status);
                if (options.rule !== undefined) params.set("ruleId", options.rule);
                if (options.limit !== undefined) params.set("limit", options.limit);
                const query = params.toString() ? `?${params.toString()}` : "";
                const result = progressionEvaluationListResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/progression/evaluations${query}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const item of result.items) outputProgressionEvaluation(dependencies.output, item);
            },
        );

    progression
        .command("show")
        .description("Show one progression evaluation with its explanation and proposed actions")
        .argument("<evaluation-id>", "Progression evaluation UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (evaluationId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = progressionEvaluationResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/progression/evaluations/${encodeURIComponent(evaluationId)}`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else {
                outputProgressionEvaluation(dependencies.output, result);
                for (const action of result.actions)
                    dependencies.output(`  action[${action.position}]\t${action.actionType}\t${action.status}`);
                if (result.missingMetrics.length > 0)
                    dependencies.output(`  missing\t${result.missingMetrics.join(", ")}`);
                dependencies.output(`  safety\t${result.safety.outcome}`);
                for (const finding of result.safety.findings) {
                    const missing =
                        finding.missingInputs.length > 0 ? ` (missing: ${finding.missingInputs.join(", ")})` : "";
                    dependencies.output(`    ${finding.policyKey}\t${finding.outcome}\t${finding.message}${missing}`);
                }
                if (result.conflict.conflicting)
                    dependencies.output(
                        `  conflict\twith rules ${result.conflict.ruleIds.join(", ")} on ${result.conflict.fields.join(", ")}`,
                    );
                dependencies.output(
                    `  auto-apply\t${result.autoApplyEligible ? "eligible" : `blocked${result.autoApplyReason ? ` (${result.autoApplyReason})` : ""}`}`,
                );
                if (result.stale) dependencies.output("  stale\tqueued for reevaluation");
                if (result.decidedAt)
                    dependencies.output(
                        `  decided\t${result.status} by ${result.decidedBy ?? "?"}${result.decisionReason ? ` (${result.decisionReason})` : ""}`,
                    );
                for (const revision of result.resultRevisions)
                    dependencies.output(
                        `  applied\t${revision.entityType} ${revision.entityId} → v${revision.version}`,
                    );
            }
        });

    progression
        .command("pending")
        .description("List pending progression proposals awaiting approval")
        .option("--limit <count>", "Maximum results (1-200)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { limit?: string; apiUrl?: string; json?: boolean }) => {
            const params = new URLSearchParams({ status: "pending" });
            if (options.limit !== undefined) params.set("limit", options.limit);
            const result = progressionEvaluationListResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/progression/evaluations?${params.toString()}`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.items) outputProgressionEvaluation(dependencies.output, item);
        });

    progression
        .command("approve")
        .description("Approve a proposal, applying its actions to the target owner")
        .argument("<evaluation-id>", "Progression evaluation UUID")
        .option("--reason <reason>", "Reason recorded with the decision")
        .option("--idempotency-key <key>", "Idempotency key so a retried approval replays instead of re-applying")
        .option("--source <source>", "Provenance source recorded with the decision")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                evaluationId: string,
                options: { reason?: string; idempotencyKey?: string; source?: string; apiUrl?: string; json?: boolean },
            ) => {
                const body: Record<string, unknown> = {};
                if (options.reason !== undefined) body.reason = options.reason;
                const result = progressionEvaluationResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/progression/evaluations/${encodeURIComponent(evaluationId)}/approve`,
                        mutationRequest("POST", body, undefined, options.idempotencyKey, provenanceOf(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else outputProgressionEvaluation(dependencies.output, result);
            },
        );

    progression
        .command("reject")
        .description("Reject/acknowledge a proposal without applying it")
        .argument("<evaluation-id>", "Progression evaluation UUID")
        .option("--reason <reason>", "Reason recorded with the decision")
        .option("--idempotency-key <key>", "Idempotency key so a retried rejection replays")
        .option("--source <source>", "Provenance source recorded with the decision")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                evaluationId: string,
                options: { reason?: string; idempotencyKey?: string; source?: string; apiUrl?: string; json?: boolean },
            ) => {
                const body: Record<string, unknown> = {};
                if (options.reason !== undefined) body.reason = options.reason;
                const result = progressionEvaluationResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/progression/evaluations/${encodeURIComponent(evaluationId)}/reject`,
                        mutationRequest("POST", body, undefined, options.idempotencyKey, provenanceOf(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else outputProgressionEvaluation(dependencies.output, result);
            },
        );
}

function outputProgressionEvaluation(
    output: (line: string) => void,
    evaluation: {
        id: string;
        ruleName: string;
        ruleVersion: number;
        status: string;
        matched: boolean;
        trigger: string;
        evaluatedAt: string;
        safety?: { outcome: string };
        conflict?: { conflicting: boolean };
        autoApplyEligible?: boolean;
    },
): void {
    const flags: string[] = [];
    if (evaluation.safety && evaluation.safety.outcome !== "pass") flags.push(`safety:${evaluation.safety.outcome}`);
    if (evaluation.conflict?.conflicting) flags.push("conflict");
    if (evaluation.autoApplyEligible) flags.push("auto-apply");
    const suffix = flags.length > 0 ? `\t[${flags.join(", ")}]` : "";
    output(
        `${evaluation.id}\t${evaluation.status}\t${evaluation.matched ? "matched" : "no-match"}\t${evaluation.trigger}\t${evaluation.ruleName} v${evaluation.ruleVersion}\t${evaluation.evaluatedAt}${suffix}`,
    );
}

function registerTrainingAdherenceCommands(training: Command, dependencies: ProgramDependencies): void {
    const adherence = training
        .command("adherence")
        .description("Read derived adherence results (overall %, components, evidence, formula version)");

    adherence
        .command("session")
        .description("Show the current adherence results for one session, one per linked planned prescription")
        .argument("<session-id>", "Training session UUID")
        .option("--evidence", "Include per-component evidence inputs in the human output")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { evidence?: boolean; apiUrl?: string; json?: boolean }) => {
            const result = sessionAdherenceResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/adherence`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.results) outputAdherenceResult(dependencies.output, item, options.evidence);
        });

    adherence
        .command("list")
        .description("Query adherence results across sessions, programs, blocks, and date ranges")
        .option("--limit <count>", "Maximum results per page (1-100, default 50)")
        .option("--cursor <cursor>", "Opaque cursor from a previous page's nextCursor")
        .option("--session <id>", "Filter by training session UUID")
        .option("--planned <id>", "Filter by planned session UUID")
        .option("--program <id>", "Filter by program UUID")
        .option("--block <id>", "Filter by program block UUID")
        .option("--scope <scope>", "Filter by activity scope (strength, running, mixed)")
        .option("--from <date>", "Only sessions on or after this YYYY-MM-DD local date")
        .option("--to <date>", "Only sessions on or before this YYYY-MM-DD local date")
        .option("--evidence", "Include per-component evidence inputs in the human output")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                limit?: string;
                cursor?: string;
                session?: string;
                planned?: string;
                program?: string;
                block?: string;
                scope?: string;
                from?: string;
                to?: string;
                evidence?: boolean;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const params = new URLSearchParams();
                if (options.limit !== undefined) params.set("limit", options.limit);
                if (options.cursor !== undefined) params.set("cursor", options.cursor);
                if (options.session !== undefined) params.set("trainingSessionId", options.session);
                if (options.planned !== undefined) params.set("plannedSessionId", options.planned);
                if (options.program !== undefined) params.set("programId", options.program);
                if (options.block !== undefined) params.set("blockId", options.block);
                if (options.scope !== undefined) params.set("scope", options.scope);
                if (options.from !== undefined) params.set("from", options.from);
                if (options.to !== undefined) params.set("to", options.to);
                const query = params.toString();
                const result = adherenceQueryResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/adherence${query ? `?${query}` : ""}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else {
                    for (const item of result.items) outputAdherenceResult(dependencies.output, item, options.evidence);
                    if (result.nextCursor !== null) dependencies.output(`next-cursor\t${result.nextCursor}`);
                }
            },
        );

    adherence
        .command("formula")
        .description("Show the stable, versioned adherence formula-display metadata and component weights")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = adherenceFormulaResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/adherence/formula`),
            );
            if (options.json) {
                dependencies.output(JSON.stringify(result));
                return;
            }
            dependencies.output(`formula\t${result.formula}\tschema-version=${result.schemaVersion}`);
            dependencies.output(`scoring\t${result.scoring}`);
            for (const component of [...result.strengthComponents, ...result.runningComponents])
                dependencies.output(
                    `component\t${component.scope}\t${component.key}\tweight=${component.weight}\t${component.label}`,
                );
        });

    adherence
        .command("recalculate")
        .description("Force a synchronous adherence recompute for a session (diagnostic)")
        .argument("<session-id>", "Training session UUID")
        .option("--idempotency-key <key>", "Idempotency key for a safe retry")
        .option("--source <source>", "Provenance source (user, agent, import, sync, system)")
        .option("--reason <reason>", "Provenance reason")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (
                sessionId: string,
                options: {
                    idempotencyKey?: string;
                    source?: string;
                    reason?: string;
                    apiUrl?: string;
                    json?: boolean;
                },
            ) => {
                const result = sessionAdherenceResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/adherence/recalculate`,
                        mutationRequest("POST", {}, undefined, options.idempotencyKey, provenanceOf(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else for (const item of result.results) outputAdherenceResult(dependencies.output, item, false);
            },
        );
}

function registerTrainingAnalyticsCommands(training: Command, dependencies: ProgramDependencies): void {
    const analytics = training
        .command("analytics")
        .description("Read derived-metric projections and drive rebuilds (issue #43, A1)");

    analytics
        .command("metrics")
        .description("Query current (and optionally superseded) derived-metric projections")
        .option("--calculator <key>", "Filter by calculator key (e.g. strength.volume)")
        .option("--scope-type <type>", "Filter by projection scope type")
        .option("--scope-id <id>", "Filter by projection scope id")
        .option("--include-superseded", "Include superseded (historical) projections")
        .option("--limit <count>", "Maximum results (1-200, default 50)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                calculator?: string;
                scopeType?: string;
                scopeId?: string;
                includeSuperseded?: boolean;
                limit?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const params = new URLSearchParams();
                if (options.calculator !== undefined) params.set("calculatorKey", options.calculator);
                if (options.scopeType !== undefined) params.set("scopeType", options.scopeType);
                if (options.scopeId !== undefined) params.set("scopeId", options.scopeId);
                if (options.includeSuperseded) params.set("includeSuperseded", "true");
                if (options.limit !== undefined) params.set("limit", options.limit);
                const query = params.toString();
                const result = metricQueryResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/analytics/metrics${query ? `?${query}` : ""}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else
                    for (const item of result.items)
                        dependencies.output(
                            `metric\t${item.calculatorKey}.v${item.calculatorVersion}\t${item.scope.type}:${item.scope.id}\t` +
                                `value=${item.numericValue ?? item.textValue ?? "—"}${item.unit ? item.unit : ""}\t` +
                                `state=${item.state}\tstale=${item.stale}`,
                        );
            },
        );

    analytics
        .command("catalog")
        .description("List the registered metric calculators and their stable display metadata")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = metricCalculatorCatalogResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/analytics/metrics/catalog`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else
                for (const calculator of result.calculators)
                    dependencies.output(
                        `calculator\t${calculator.key}.v${calculator.version}\t${calculator.scopeKind}\t` +
                            `${calculator.label}\tunit=${calculator.unit ?? "—"}\tdims=${calculator.dimensions.join(",")}`,
                    );
        });

    analytics
        .command("records")
        .description("Query current (and optionally superseded) personal-record findings (issue #45, A3)")
        .option("--record <key>", "Filter by record key (e.g. record.max_load)")
        .option("--scope-type <type>", "Filter by finding scope type (profile-exercise, profile-exercise-family)")
        .option("--scope-id <id>", "Filter by finding scope id (profileId:exerciseId)")
        .option("--include-superseded", "Include superseded (historical) records")
        .option("--limit <count>", "Maximum results (1-200, default 50)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                record?: string;
                scopeType?: string;
                scopeId?: string;
                includeSuperseded?: boolean;
                limit?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const params = new URLSearchParams();
                if (options.record !== undefined) params.set("findingKey", options.record);
                if (options.scopeType !== undefined) params.set("scopeType", options.scopeType);
                if (options.scopeId !== undefined) params.set("scopeId", options.scopeId);
                if (options.includeSuperseded) params.set("includeSuperseded", "true");
                if (options.limit !== undefined) params.set("limit", options.limit);
                const query = params.toString();
                const result = findingQueryResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/analytics/records${query ? `?${query}` : ""}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else
                    for (const item of result.items)
                        dependencies.output(
                            `record\t${item.findingKey}.v${item.findingVersion}\t${item.scope.type}:${item.scope.id}\t` +
                                `value=${item.numericValue ?? "—"}${item.unit ?? ""}\t` +
                                `dims=${Object.entries(item.dimensions)
                                    .map(([key, value]) => `${key}=${value}`)
                                    .join(",")}\tstate=${item.state}`,
                        );
            },
        );

    analytics
        .command("records-catalog")
        .description("List the personal-record types and their stable display metadata")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { apiUrl?: string; json?: boolean }) => {
            const result = personalRecordCatalogResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/analytics/records/catalog`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else
                for (const record of result.records)
                    dependencies.output(
                        `record\t${record.key}.v${record.version}\t${record.label}\tunit=${record.unit}\t` +
                            `dims=${record.dimensions.join(",")}`,
                    );
        });

    analytics
        .command("rebuild")
        .description("Force a synchronous derived-metric rebuild (diagnostic)")
        .option("--mode <mode>", "targeted (drain invalidations), full (sweep all), or scope", "targeted")
        .option("--dependency <dependency>", "For --mode scope: session|exercise|context|zone|plan")
        .option("--scope-type <type>", "For --mode scope: the scope type that changed")
        .option("--scope-id <id>", "For --mode scope: the scope id that changed")
        .option("--source <source>", "Provenance source (user, agent, import, sync, system)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                mode?: string;
                dependency?: string;
                scopeType?: string;
                scopeId?: string;
                source?: string;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const body =
                    options.mode === "scope"
                        ? {
                              mode: "scope",
                              dependency: options.dependency,
                              scopeType: options.scopeType,
                              scopeId: options.scopeId,
                          }
                        : { mode: options.mode ?? "targeted" };
                const result = metricRebuildResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/analytics/rebuild`,
                        mutationRequest("POST", body, undefined, undefined, provenanceOf(options)),
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else
                    dependencies.output(
                        `rebuild\trecomputed=${result.recomputed}\tdrained-invalidations=${result.drainedInvalidations}`,
                    );
            },
        );
}

function registerTrainingSessionCommands(training: Command, dependencies: ProgramDependencies): void {
    const sessions = training.command("sessions").description("Track live and retrospective training sessions");

    sessions
        .command("list")
        .description("List training sessions newest-first with keyset pagination and filters")
        .option("--limit <count>", "Maximum sessions per page (1-100, default 50)")
        .option("--cursor <cursor>", "Opaque cursor from a previous page's nextCursor")
        .option("--status <status>", "Filter by lifecycle status (draft, in_progress, completed)")
        .option("--from <date>", "Only sessions on or after this YYYY-MM-DD local date")
        .option("--to <date>", "Only sessions on or before this YYYY-MM-DD local date")
        .option("--search <text>", "Match session title or notes")
        .option("--include-archived", "Include archived sessions")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (options: {
                limit?: string;
                cursor?: string;
                status?: string;
                from?: string;
                to?: string;
                search?: string;
                includeArchived?: boolean;
                apiUrl?: string;
                json?: boolean;
            }) => {
                const params = new URLSearchParams();
                if (options.limit !== undefined) params.set("limit", options.limit);
                if (options.cursor !== undefined) params.set("cursor", options.cursor);
                if (options.status !== undefined) params.set("status", options.status);
                if (options.from !== undefined) params.set("from", options.from);
                if (options.to !== undefined) params.set("to", options.to);
                if (options.search !== undefined) params.set("search", options.search);
                if (options.includeArchived) params.set("includeArchived", "true");
                const query = params.toString();
                const result = trainingSessionListResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/sessions${query ? `?${query}` : ""}`,
                    ),
                );
                if (options.json) dependencies.output(JSON.stringify(result));
                else {
                    for (const session of result.items) outputTrainingSession(dependencies.output, session, false);
                    if (result.nextCursor !== null) dependencies.output(`next-cursor\t${result.nextCursor}`);
                }
            },
        );

    sessions
        .command("show")
        .description("Show one training session with its activities and pain records")
        .argument("<session-id>", "Training session UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}`,
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("create")
        .description("Create a training session (planned or unplanned) from JSON, a file, or stdin")
        .option("--input <json>", "CreateTrainingSessionRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: SessionMutationOptions) => {
            const input = createTrainingSessionRequestSchema.parse(readJsonBody(options, "{}"));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("start-planned")
        .description("Start an in-progress session from a planned session, freezing its resolved targets")
        .option("--input <json>", "StartPlannedTrainingSessionRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: SessionMutationOptions) => {
            const input = startPlannedTrainingSessionRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/start-planned`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("map")
        .description("Record planned/actual mappings for a session (substitutions, splits, combines)")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "RecordSessionMappingsRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = recordSessionMappingsRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/mappings`,
                    mutationRequest("POST", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("update")
        .description("Update a training session's metadata, readiness, timing, activities, or pain records")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "UpdateTrainingSessionRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = updateTrainingSessionRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}`,
                    mutationRequest("PATCH", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("complete")
        .description("Complete an in-progress session, stamping the end instant and post ratings")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "CompleteTrainingSessionRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = completeTrainingSessionRequestSchema.parse(readJsonBody(options, "{}"));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/complete`,
                    mutationRequest("POST", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    for (const [command, path, schema, description] of [
        ["start-empty", "start-empty", startEmptyTrainingSessionRequestSchema, "Start an empty in-progress session"],
        [
            "start-template",
            "start-template",
            startTemplateTrainingSessionRequestSchema,
            "Start an in-progress session from a workout template",
        ],
        [
            "start-previous",
            "start-previous",
            startPreviousTrainingSessionRequestSchema,
            "Start an in-progress session by repeating a previous workout",
        ],
    ] as const)
        sessions
            .command(command)
            .description(description)
            .option("--input <json>", `${command} request JSON object`)
            .option("--file <path>", "Read the request body from a file (use - for stdin)")
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
            .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(async (options: SessionMutationOptions) => {
                const input = schema.parse(readJsonBody(options, "{}"));
                const result = trainingSessionResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/sessions/${path}`,
                        mutationRequest("POST", input, undefined, options.idempotencyKey, provenanceOf(options)),
                    ),
                );
                outputTrainingSession(dependencies.output, result, options.json);
            });

    sessions
        .command("active")
        .description("Show the complete active-session view (session tree plus its frozen plan)")
        .argument("<session-id>", "Training session UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = activeTrainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/active`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else {
                outputTrainingSession(dependencies.output, result, false);
                dependencies.output(`  plans: ${result.plans.length}`);
            }
        });

    sessions
        .command("completion-preview")
        .description("Preview a completion: validation issues plus projected planned-session outcomes")
        .argument("<session-id>", "Training session UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = completionPreviewResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/completion-preview`,
                ),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else {
                for (const issue of result.issues) dependencies.output(`  [${issue.severity}] ${issue.message}`);
                for (const outcome of result.plannedOutcomes)
                    dependencies.output(
                        `  plan ${outcome.plannedSessionId} → ${outcome.projectedStatus} (${outcome.coveredSetCount}/${outcome.prescribedSetCount})`,
                    );
            }
        });

    sessions
        .command("add-activity")
        .description("Append one activity to a session (live entry)")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "AddSessionActivityRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = addSessionActivityRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/activities`,
                    mutationRequest("POST", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("record-set")
        .description("Record one performed set inside an occurrence, with an optional mapping")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "RecordPerformedSetRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = recordPerformedSetRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/strength/sets`,
                    mutationRequest("POST", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sessions
        .command("update-set")
        .description("Patch an existing performed set, optionally updating its mapping")
        .argument("<session-id>", "Training session UUID")
        .argument("<set-id>", "Performed set UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "UpdatePerformedSetRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, setId: string, options: SessionMutationOptions) => {
            const input = updatePerformedSetRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/strength/sets/${encodeURIComponent(setId)}`,
                    mutationRequest("PATCH", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    for (const action of ["start", "reopen", "archive", "restore"] as const)
        sessions
            .command(action)
            .description(`${capitalizeWord(action)} a training session`)
            .argument("<session-id>", "Training session UUID")
            .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
            .option("--idempotency-key <key>", "Stable key for safely retrying this command")
            .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
            .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
            .option("--api-url <url>", "Override the Kinetix API URL")
            .option("--json", "Emit machine-readable JSON")
            .action(async (sessionId: string, options: SessionMutationOptions) => {
                const result = trainingSessionResponseSchema.parse(
                    await responseJson(
                        dependencies,
                        `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/${action}`,
                        mutationRequest("POST", {}, options.version, options.idempotencyKey, provenanceOf(options)),
                    ),
                );
                outputTrainingSession(dependencies.output, result, options.json);
            });
}

/**
 * `kin training sets add|update|complete` — a focused verb group over a session's performed strength
 * sets (design §19). Each command is an HTTP adapter over the session aggregate's set endpoints, carries
 * the session's expected `--version`, and accepts its body via `--input`, `--file`, or stdin (`--file -`).
 */
function registerTrainingSetCommands(training: Command, dependencies: ProgramDependencies): void {
    const sets = training.command("sets").description("Add, update, and complete performed strength sets");

    sets.command("add")
        .description("Record one performed set inside an occurrence, with an optional mapping")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "RecordPerformedSetRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = recordPerformedSetRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/strength/sets`,
                    mutationRequest("POST", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sets.command("update")
        .description("Patch an existing performed set, optionally updating its mapping")
        .argument("<session-id>", "Training session UUID")
        .argument("<set-id>", "Performed set UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "UpdatePerformedSetRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, setId: string, options: SessionMutationOptions) => {
            const input = updatePerformedSetRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/strength/sets/${encodeURIComponent(setId)}`,
                    mutationRequest("PATCH", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    sets.command("complete")
        .description("Mark a performed set completed (merges status onto any supplied patch)")
        .argument("<session-id>", "Training session UUID")
        .argument("<set-id>", "Performed set UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "UpdatePerformedSetRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, setId: string, options: SessionMutationOptions) => {
            const provided = updatePerformedSetRequestSchema.parse(readJsonBody(options, "{}"));
            const input = updatePerformedSetRequestSchema.parse({ ...provided, status: "completed" });
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/strength/sets/${encodeURIComponent(setId)}`,
                    mutationRequest("PATCH", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });
}

function registerTrainingRunningCommands(training: Command, dependencies: ProgramDependencies): void {
    const runs = training.command("runs").description("Record and inspect manual running summaries");

    runs.command("set")
        .description("Upsert the manual running summary of a running activity")
        .argument("<session-id>", "Training session UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "SetRunningActivityRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, options: SessionMutationOptions) => {
            const input = setRunningActivityRequestSchema.parse(readJsonBody(options));
            const result = trainingSessionResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/running`,
                    mutationRequest("PUT", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputTrainingSession(dependencies.output, result, options.json);
        });

    runs.command("show")
        .description("Show the manual running summary of one activity, with its derived pace")
        .argument("<session-id>", "Training session UUID")
        .argument("<activity-id>", "Running activity UUID")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, activityId: string, options: { apiUrl?: string; json?: boolean }) => {
            const result = runningActivitySummaryResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/sessions/${encodeURIComponent(sessionId)}/running/${encodeURIComponent(activityId)}`,
                ),
            );
            outputRunningSummary(dependencies.output, result, options.json);
        });
}

/**
 * `kin run add|update|show|list` — an ergonomic alias over the Training run contracts (design §19;
 * PRD R3). It reuses the same HTTP client, `--json`, non-interactive input, explicit version, and
 * idempotency-key conventions as the rest of the CLI; every write ultimately maps to the same
 * TrainingSession aggregate as strength work.
 */
function registerRunCommands(program: Command, dependencies: ProgramDependencies): void {
    const run = program.command("run").description("Log and inspect manual and mixed-session runs");

    run.command("add")
        .description("Log a manual run: create a session with one running activity and complete it")
        .option("--input <json>", "AddRunRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: SessionMutationOptions) => {
            const input = addRunRequestSchema.parse(readJsonBody(options));
            const result = runViewResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/runs`,
                    mutationRequest("POST", input, undefined, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputRunView(dependencies.output, result, options.json);
        });

    run.command("update")
        .description("Correct a run's summary/detail and plan mappings for one running activity")
        .argument("<session-id>", "Training session UUID")
        .argument("<activity-id>", "Running activity UUID")
        .requiredOption("--version <version>", "Expected session version", parsePositiveInteger)
        .option("--input <json>", "UpdateRunRequest JSON object")
        .option("--file <path>", "Read the request body from a file (use - for stdin)")
        .option("--idempotency-key <key>", "Stable key for safely retrying this command")
        .option("--source <source>", "Provenance channel recorded in history (user, agent, import, sync, system)")
        .option("--reason <reason>", "Free-text reason recorded in history (e.g. a manual correction)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (sessionId: string, activityId: string, options: SessionMutationOptions) => {
            const input = updateRunRequestSchema.parse(readJsonBody(options));
            const result = runViewResponseSchema.parse(
                await responseJson(
                    dependencies,
                    `${resolveApiUrl(options.apiUrl)}/training/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(activityId)}`,
                    mutationRequest("PUT", input, options.version, options.idempotencyKey, provenanceOf(options)),
                ),
            );
            outputRunView(dependencies.output, result, options.json);
        });

    run.command("show")
        .description("Show a run: the session's running activity, its derived pace, and plan mappings")
        .argument("<session-id>", "Training session UUID")
        .argument("[activity-id]", "Running activity UUID (defaults to the session's first run)")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(
            async (sessionId: string, activityId: string | undefined, options: { apiUrl?: string; json?: boolean }) => {
                const path = activityId
                    ? `/training/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(activityId)}`
                    : `/training/runs/${encodeURIComponent(sessionId)}`;
                const result = runViewResponseSchema.parse(
                    await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}${path}`),
                );
                outputRunView(dependencies.output, result, options.json);
            },
        );

    run.command("list")
        .description("List runs across sessions with distance and derived pace")
        .option("--include-archived", "Include runs from archived sessions")
        .option("--api-url <url>", "Override the Kinetix API URL")
        .option("--json", "Emit machine-readable JSON")
        .action(async (options: { includeArchived?: boolean; apiUrl?: string; json?: boolean }) => {
            const query = options.includeArchived ? "?includeArchived=true" : "";
            const result = runListResponseSchema.parse(
                await responseJson(dependencies, `${resolveApiUrl(options.apiUrl)}/training/runs${query}`),
            );
            if (options.json) dependencies.output(JSON.stringify(result));
            else for (const item of result.items) outputRunListItem(dependencies.output, item);
        });
}

function outputRunView(
    output: (message: string) => void,
    run: ReturnType<typeof runViewResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) {
        output(JSON.stringify(run));
        return;
    }
    const { running } = run;
    const distance = running.distance ? `${running.distance.value}${running.distance.unit}` : "-";
    const moving = running.movingTime ? `${running.movingTime.value}${running.movingTime.unit}` : "-";
    const pace =
        running.derivedPace.secondsPerKilometre === null
            ? `pace=- (${running.derivedPace.exclusions.join(",") || "unavailable"})`
            : `pace=${formatPace(running.derivedPace.secondsPerKilometre)}/km`;
    const line = `${run.sessionId}\t${run.activityId}\tv${run.version}\t${run.status}\t${run.localDate}\t${run.title ?? ""}`;
    // Notes can carry personal reflections; the human view signals presence only (use --json for content).
    output(run.notes ? `${line}\tnotes=[redacted]` : line);
    output(`\tdistance=${distance}\tmoving=${moving}\t${pace}`);
    const structure: string[] = [];
    if (running.steps.length > 0) structure.push(`steps=${running.steps.length}`);
    if (running.splits.length > 0) structure.push(`splits=${running.splits.length}`);
    if (running.zoneTimes.length > 0) structure.push(`zones=${running.zoneTimes.length}`);
    if (run.runStepMappings.length > 0) structure.push(`mappings=${run.runStepMappings.length}`);
    if (running.gearItemId !== null) structure.push(`gear=${running.gearItemId}`);
    if (structure.length > 0) output(`\t${structure.join("\t")}`);
}

function outputRunListItem(
    output: (message: string) => void,
    item: ReturnType<typeof runListResponseSchema.parse>["items"][number],
): void {
    const distance = item.distanceMetres === null ? "-" : `${(Number(item.distanceMetres) / 1000).toFixed(2)}km`;
    const pace =
        item.derivedPaceSecondsPerKm === null ? "pace=-" : `pace=${formatPace(item.derivedPaceSecondsPerKm)}/km`;
    output(
        `${item.sessionId}\t${item.activityId}\tv${item.version}\t${item.status}\t${item.localDate}\tdistance=${distance}\t${pace}\t${item.title ?? ""}`,
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

/** Caller-declared provenance recorded in history and echoed on the emitted outbox event. */
interface Provenance {
    source?: string;
    reason?: string;
}

function mutationRequest(
    method: "POST" | "PATCH" | "PUT",
    body: unknown,
    version?: number,
    idempotencyKey?: string,
    provenance?: Provenance,
): RequestInit {
    const headers = new Headers({ "content-type": "application/json" });
    if (version !== undefined) headers.set("if-match", `"${version}"`);
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    if (provenance?.source) headers.set("x-kinetix-source", provenance.source);
    if (provenance?.reason) headers.set("x-kinetix-reason", provenance.reason);
    return { method, headers, body: JSON.stringify(body) };
}

/** Pull the provenance flags off a parsed command's options for {@link mutationRequest}. */
function provenanceOf(options: { source?: string; reason?: string }): Provenance {
    return { source: options.source, reason: options.reason };
}

/** Options shared by every `kin training sessions`/`sets` mutation: body input, version, and provenance. */
interface SessionMutationOptions {
    input?: string;
    file?: string;
    version?: number;
    idempotencyKey?: string;
    source?: string;
    reason?: string;
    apiUrl?: string;
    json?: boolean;
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

/** Read a bulk payload from --input, a --file path, or stdin (--file -). Files support large trees. */
function readEnvelopeInput(options: { file?: string; input?: string }): unknown {
    if (options.input !== undefined) return parseJsonInput(options.input);
    if (options.file === undefined) throw new Error("Provide the bulk program via --input <json> or --file <path>");
    const raw = options.file === "-" ? readFileSync(0, "utf8") : readFileSync(options.file, "utf8");
    return parseJsonInput(raw);
}

/**
 * Read a JSON request body from `--input <json>`, a `--file <path>`, or stdin (`--file -`). When neither
 * is supplied the caller may pass a `fallback` (e.g. `"{}"`) for commands whose body is optional.
 */
function readJsonBody(options: { input?: string; file?: string }, fallback?: string): unknown {
    if (options.input !== undefined) return parseJsonInput(options.input);
    if (options.file !== undefined) {
        const raw = options.file === "-" ? readFileSync(0, "utf8") : readFileSync(options.file, "utf8");
        return parseJsonInput(raw);
    }
    if (fallback !== undefined) return parseJsonInput(fallback);
    throw new Error("Provide the request body via --input <json> or --file <path> (use - for stdin)");
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

function outputProgressionRule(
    output: (message: string) => void,
    rule: ReturnType<typeof progressionRuleResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) output(JSON.stringify(rule));
    else
        output(
            `${rule.id}\t${rule.version}\t${rule.status}\t${rule.enabled ? "enabled" : "disabled"}\t${rule.scope.type}\t${rule.target.mode}\t${rule.name}`,
        );
}

function outputProgram(
    output: (message: string) => void,
    program:
        | ReturnType<typeof programResponseSchema.parse>
        | ReturnType<typeof activateProgramResponseSchema.parse>
        | ReturnType<typeof changeProgramStartDateResponseSchema.parse>
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

function outputAdherenceResult(
    output: (message: string) => void,
    result: ReturnType<typeof sessionAdherenceResponseSchema.parse>["results"][number],
    evidence?: boolean,
): void {
    const overall = result.overall === null ? "n/a" : String(result.overall);
    output(
        `result\t${result.id}\tsession=${result.trainingSessionId}\tstatus=${result.status}\tscope=${result.scope}` +
            `\toverall=${overall}\tformula=${result.formula}\tplanned=${result.plannedSessionTitle ?? ""}`,
    );
    if (result.exclusions.length > 0) output(`  exclusions\t${result.exclusions.join(",")}`);
    for (const component of result.components) {
        const score = component.score === null ? "excluded" : String(component.score);
        const flag = component.included ? "" : `\treason=${component.exclusion ?? "excluded"}`;
        const detail = evidence ? `\tinputs=${JSON.stringify(component.inputs)}` : "";
        output(
            `  component\t${component.key}\tscope=${component.scope}\tscore=${score}\tweight=${component.weight}${flag}${detail}`,
        );
    }
}

function outputTrainingSession(
    output: (message: string) => void,
    session:
        | ReturnType<typeof trainingSessionResponseSchema.parse>
        | ReturnType<typeof trainingSessionListResponseSchema.parse>["items"][number],
    json?: boolean,
): void {
    if (json) {
        // Machine-readable output is the authoritative payload and is never redacted.
        output(JSON.stringify(session));
        return;
    }
    const line = `${session.id}\t${session.version}\t${session.status}\t${session.localDate}\t${session.title ?? ""}`;
    // Session notes can carry personal reflections; the human view signals their presence without ever
    // printing the content (design §19; use --json to retrieve the full payload).
    output(session.notes ? `${line}\tnotes=[redacted]` : line);
}

function outputRunningSummary(
    output: (message: string) => void,
    summary: ReturnType<typeof runningActivitySummaryResponseSchema.parse>,
    json?: boolean,
): void {
    if (json) {
        output(JSON.stringify(summary));
        return;
    }
    const { running } = summary;
    const distance = running.distance ? `${running.distance.value}${running.distance.unit}` : "-";
    const moving = running.movingTime ? `${running.movingTime.value}${running.movingTime.unit}` : "-";
    const pace =
        running.derivedPace.secondsPerKilometre === null
            ? `pace=- (${running.derivedPace.exclusions.join(",") || "unavailable"})`
            : `pace=${formatPace(running.derivedPace.secondsPerKilometre)}/km`;
    output(`${summary.activityId}\tdistance=${distance}\tmoving=${moving}\t${pace}`);
    // Structured-running counts (design 11.3; PRD RN-3/4/5/6): only surface sections that carry data.
    const structure: string[] = [];
    if (running.steps.length > 0) structure.push(`steps=${running.steps.length}`);
    if (running.splits.length > 0) structure.push(`splits=${running.splits.length}`);
    if (running.zoneTimes.length > 0) structure.push(`zones=${running.zoneTimes.length}`);
    if (running.route !== null) structure.push("route=yes");
    if (running.gearItemId !== null) structure.push(`gear=${running.gearItemId}`);
    if (structure.length > 0) output(`\t${structure.join("\t")}`);
}

/** Render seconds-per-kilometre as a `m:ss` running pace. */
function formatPace(secondsPerKilometre: number): string {
    const total = Math.round(secondsPerKilometre);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
