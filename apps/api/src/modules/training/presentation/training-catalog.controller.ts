import { Controller, Get, HttpException, Inject, Optional, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
    equipmentCatalogListResponseSchema,
    exerciseCatalogListQuerySchema,
    exerciseCatalogListResponseSchema,
    movementPatternCatalogListResponseSchema,
    muscleCatalogListResponseSchema,
    tagCatalogListResponseSchema,
    type EquipmentCatalogListResponse,
    type ExerciseCatalogItemResponse,
    type ExerciseCatalogListResponse,
    type ExtensibleCatalogItemResponse,
    type MovementPatternCatalogListResponse,
    type MuscleCatalogItemResponse,
    type MuscleCatalogListResponse,
    type TagCatalogItemResponse,
    type TagCatalogListResponse,
} from "@kinetix/types";

import {
    TRAINING_CATALOG_QUERIES,
    TRAINING_EXERCISE_CATALOG,
    type ExerciseCatalogItem,
    type ExtensibleCatalogItem,
    type MuscleCatalogItem,
    type TagCatalogItem,
    type TrainingCatalogQueries,
    type TrainingExerciseCatalogPort,
} from "#src/modules/training/application/index";

@ApiTags("training catalog")
@Controller({ path: "training/catalog", version: "1" })
export class TrainingCatalogController {
    constructor(
        @Inject(TRAINING_CATALOG_QUERIES)
        private readonly queries: TrainingCatalogQueries,
        @Optional()
        @Inject(TRAINING_EXERCISE_CATALOG)
        private readonly exerciseCatalog?: TrainingExerciseCatalogPort,
    ) {}

    @Get("muscles")
    @ApiOperation({ summary: "List system-controlled muscle groups" })
    @ApiOkResponse({ description: "Deterministically ordered active muscle groups" })
    async listMuscles(): Promise<MuscleCatalogListResponse> {
        return muscleCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: (await this.queries.listMuscles()).map(mapMuscle),
        });
    }

    @Get("equipment")
    @ApiOperation({ summary: "List equipment types" })
    @ApiOkResponse({ description: "Deterministically ordered active equipment types" })
    async listEquipment(): Promise<EquipmentCatalogListResponse> {
        return equipmentCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: (await this.queries.listEquipment()).map(mapExtensible),
        });
    }

    @Get("movement-patterns")
    @ApiOperation({ summary: "List movement patterns" })
    @ApiOkResponse({ description: "Deterministically ordered active movement patterns" })
    async listMovementPatterns(): Promise<MovementPatternCatalogListResponse> {
        return movementPatternCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: (await this.queries.listMovementPatterns()).map(mapExtensible),
        });
    }

    @Get("tags")
    @ApiOperation({ summary: "List Training tags, including run classifications" })
    @ApiOkResponse({ description: "Deterministically ordered active Training tags" })
    async listTags(): Promise<TagCatalogListResponse> {
        return tagCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: (await this.queries.listTags()).map(mapTag),
        });
    }

    @Get("exercises")
    @ApiOperation({ summary: "List exercise definitions with catalog metadata" })
    @ApiOkResponse({ description: "Deterministically ordered active exercise definitions" })
    async listExercises(@Query() rawQuery: Record<string, unknown> = {}): Promise<ExerciseCatalogListResponse> {
        const parsed = exerciseCatalogListQuerySchema.safeParse(rawQuery);
        if (!parsed.success) throw contractValidationException("Exercise query validation failed", parsed.error.issues);
        const page = this.exerciseCatalog
            ? await this.exerciseCatalog.listExercises(parsed.data)
            : { items: await this.queries.listExercises(), nextCursor: null };
        return exerciseCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: page.items.map(mapExercise),
            nextCursor: page.nextCursor,
        });
    }
}

function mapMuscle(item: MuscleCatalogItem): MuscleCatalogItemResponse {
    return { schemaVersion: 1, ...item };
}

function mapExtensible(item: ExtensibleCatalogItem): ExtensibleCatalogItemResponse {
    return { schemaVersion: 1, ...item };
}

function mapTag(item: TagCatalogItem): TagCatalogItemResponse {
    return { schemaVersion: 1, ...item };
}

export function mapExercise(item: ExerciseCatalogItem): ExerciseCatalogItemResponse {
    return {
        schemaVersion: 1,
        ...item,
        forkedFromExerciseId: item.forkedFromExerciseId ?? null,
        equipment: mapExtensible(item.equipment),
        movementPattern: mapExtensible(item.movementPattern),
        muscles: item.muscles.map(assignment => ({
            muscle: mapMuscle(assignment.muscle),
            role: assignment.role,
        })),
        tags: item.tags.map(mapTag),
        relationships: [...(item.relationships ?? [])],
        aliases: [...item.aliases],
        supportedMeasurements: [...item.supportedMeasurements],
    };
}

export function contractValidationException(
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
