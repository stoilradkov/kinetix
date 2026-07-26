import chalk from "chalk";
import { Command } from "commander";

import { parseCliEnv } from "@kinetix/config";
import { healthResponseSchema, restoreRevisionResponseSchema, revisionHistoryResponseSchema } from "@kinetix/types";

import { apiErrorFrom } from "#src/api-error";

interface ProgramDependencies {
    fetch: typeof globalThis.fetch;
    output: (message: string) => void;
}

const defaults: ProgramDependencies = {
    fetch: globalThis.fetch,
    output: console.log,
};

export function createProgram(dependencies: ProgramDependencies = defaults): Command {
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

    const training = program.command("training").description("Manage Training data");
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
