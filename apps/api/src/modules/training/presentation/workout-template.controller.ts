import { randomUUID } from "node:crypto";

import {
    Body,
    Controller,
    Get,
    Headers,
    HttpException,
    Inject,
    Optional,
    Param,
    Patch,
    Post,
    Query,
    Res,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";

import {
    createWorkoutTemplateRequestSchema,
    updateWorkoutTemplateRequestSchema,
    workoutTemplateListResponseSchema,
    workoutTemplateResponseSchema,
    type WorkoutTemplateListResponse,
    type WorkoutTemplateResponse,
} from "@kinetix/types";

import {
    SESSION_PRESCRIPTION_REPOSITORY,
    WORKOUT_TEMPLATE_COMMANDS,
    WORKOUT_TEMPLATE_REPOSITORY,
    WorkoutTemplateNotFoundError,
    type SessionPrescriptionRepository,
    type WorkoutTemplateCommands,
    type WorkoutTemplateDetail,
    type WorkoutTemplateMutationMetadata,
    type WorkoutTemplateRepository,
} from "#src/modules/training/application/index";
import type { SessionPrescriptionState } from "#src/modules/training/domain/index";
import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    IDEMPOTENT_COMMAND_EXECUTOR,
    type IdempotentCommandExecutor,
} from "#src/platform/application/index";
import { entityId } from "#src/platform/domain/index";
import { formatRevisionEtag, parseRevisionEtag } from "#src/platform/presentation/revision-etag";

interface HeaderResponse {
    setHeader(name: string, value: string): void;
}

@ApiTags("training templates")
@Controller({ path: "training/templates", version: "1" })
export class WorkoutTemplateController {
    constructor(
        @Inject(WORKOUT_TEMPLATE_COMMANDS)
        private readonly commands: WorkoutTemplateCommands,
        @Inject(WORKOUT_TEMPLATE_REPOSITORY)
        private readonly repository: WorkoutTemplateRepository,
        @Inject(SESSION_PRESCRIPTION_REPOSITORY)
        private readonly prescriptions: SessionPrescriptionRepository,
        @Optional()
        @Inject(IDEMPOTENT_COMMAND_EXECUTOR)
        private readonly idempotency?: IdempotentCommandExecutor,
    ) {}

    @Get()
    @ApiOperation({ summary: "List workout templates, optionally including archived ones" })
    @ApiQuery({ name: "includeArchived", required: false })
    async list(@Query("includeArchived") includeArchived: string | undefined): Promise<WorkoutTemplateListResponse> {
        const templates = await this.repository.listTemplates({ includeArchived: includeArchived === "true" });
        const trees = await this.prescriptions.loadTrees(templates.map(template => template.currentPrescriptionId));
        const treesById = new Map(trees.map(tree => [tree.id, tree]));
        const items = templates.map(template => ({
            ...template,
            activities: activitySummaries(treesById.get(template.currentPrescriptionId)),
        }));
        return workoutTemplateListResponseSchema.parse({ items });
    }

    @Post()
    @ApiOperation({ summary: "Create a workout template for the active profile" })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    create(
        @Body() rawBody: unknown,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<WorkoutTemplateResponse> {
        const request = parseContract(
            createWorkoutTemplateRequestSchema,
            rawBody,
            "Workout template validation failed",
        );
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.workout-template.create",
            idempotencyKey,
            request,
            metadata,
            response,
            status: 201,
            command: transaction => this.commands.create(request, metadata, transaction),
        });
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one workout template with its current prescription" })
    @ApiParam({ name: "id", format: "uuid" })
    async get(
        @Param("id") id: string,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<WorkoutTemplateResponse> {
        const template = await this.repository.readTemplate(templateId(id));
        if (!template) throw new WorkoutTemplateNotFoundError(id);
        const prescription = await this.prescriptions.loadTree(template.currentPrescriptionId);
        if (!prescription)
            throw new ApplicationNotFoundError(`Prescription ${template.currentPrescriptionId} was not found`, {
                prescriptionId: template.currentPrescriptionId,
            });
        response.setHeader("ETag", formatRevisionEtag(template.version));
        return workoutTemplateResponseSchema.parse(toResponse({ template, prescription }));
    }

    @Patch(":id")
    @ApiOperation({ summary: "Update a workout template, republishing its prescription when supplied" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    @ApiHeader({ name: "Idempotency-Key", required: false })
    update(
        @Param("id") id: string,
        @Body() rawBody: unknown,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<WorkoutTemplateResponse> {
        const request = parseContract(
            updateWorkoutTemplateRequestSchema,
            rawBody,
            "Workout template update validation failed",
        );
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.workout-template.update",
            idempotencyKey,
            request: { id, expectedVersion, body: request },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.update(id, expectedVersion, request, metadata, transaction),
        });
    }

    @Post(":id/archive")
    @ApiOperation({ summary: "Archive a workout template" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    archive(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<WorkoutTemplateResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.workout-template.archive",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.archive(id, expectedVersion, metadata, transaction),
        });
    }

    @Post(":id/restore")
    @ApiOperation({ summary: "Restore an archived workout template" })
    @ApiParam({ name: "id", format: "uuid" })
    @ApiHeader({ name: "If-Match", required: true })
    restore(
        @Param("id") id: string,
        @Headers("if-match") ifMatch: string | undefined,
        @Headers("x-correlation-id") rawCorrelationId: string | undefined,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Res({ passthrough: true }) response: HeaderResponse,
    ): Promise<WorkoutTemplateResponse> {
        const expectedVersion = expectedVersionFrom(ifMatch);
        const metadata = mutationMetadata(rawCorrelationId);
        return this.executeMutation({
            operation: "training.workout-template.restore",
            idempotencyKey,
            request: { id, expectedVersion },
            metadata,
            response,
            status: 200,
            command: transaction => this.commands.restore(id, expectedVersion, metadata, transaction),
        });
    }

    private async executeMutation(input: {
        readonly operation: string;
        readonly idempotencyKey?: string;
        readonly request: unknown;
        readonly metadata: WorkoutTemplateMutationMetadata;
        readonly response: HeaderResponse;
        readonly status: number;
        readonly command: (transaction?: unknown) => Promise<WorkoutTemplateDetail>;
    }): Promise<WorkoutTemplateResponse> {
        const perform = async (transaction?: unknown) =>
            workoutTemplateResponseSchema.parse(toResponse(await input.command(transaction)));
        let body: WorkoutTemplateResponse;
        if (input.idempotencyKey !== undefined) {
            if (!this.idempotency) throw new Error("Idempotency support is not configured");
            const result = await this.idempotency.execute(
                {
                    operation: input.operation,
                    key: input.idempotencyKey,
                    request: input.request,
                    context: input.metadata,
                },
                async transaction => ({ status: input.status, body: await perform(transaction) }),
            );
            body = result.body;
            input.response.setHeader("Idempotency-Replayed", String(result.replayed));
        } else {
            body = await perform();
        }
        input.response.setHeader("ETag", formatRevisionEtag(body.version));
        return body;
    }
}

function toResponse(detail: WorkoutTemplateDetail): unknown {
    const prescription: SessionPrescriptionState = detail.prescription;
    return { ...detail.template, prescription };
}

function activitySummaries(prescription: SessionPrescriptionState | undefined) {
    if (!prescription) return [];
    return prescription.activities.map(activity => ({
        type: activity.type,
        exerciseCount: activity.strength?.exercises.length ?? 0,
        setCount: activity.strength?.exercises.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0,
        runStepCount: activity.running?.steps.length ?? 0,
    }));
}

function templateId(value: string) {
    try {
        return entityId(value);
    } catch {
        throw new ApplicationValidationError("Workout template ID must be a UUID", {
            workoutTemplateId: ["Workout template ID must be a UUID"],
        });
    }
}

function parseContract<Output>(
    schema: {
        safeParse(
            value: unknown,
        ):
            | { success: true; data: Output }
            | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
    },
    value: unknown,
    message: string,
): Output {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw contractValidationException(message, parsed.error.issues);
    return parsed.data;
}

function contractValidationException(
    message: string,
    issues: readonly { path: readonly PropertyKey[]; message: string }[],
): HttpException {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) {
        const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
        (fieldErrors[path] ??= []).push(issue.message);
    }
    return new HttpException({ code: "VALIDATION_FAILED", message, fieldErrors }, 422);
}

function mutationMetadata(rawCorrelationId: string | undefined): WorkoutTemplateMutationMetadata {
    return { correlationId: rawCorrelationId?.trim() || randomUUID(), actorId: null, source: "user" };
}

function expectedVersionFrom(ifMatch: string | undefined): number {
    if (!ifMatch) throw new ExpectedVersionRequiredError();
    try {
        return parseRevisionEtag(ifMatch);
    } catch (error) {
        throw new ApplicationValidationError(error instanceof Error ? error.message : "If-Match is invalid", {
            ifMatch: ["If-Match must be a quoted positive version"],
        });
    }
}
