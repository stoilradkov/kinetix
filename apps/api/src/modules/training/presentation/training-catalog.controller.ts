import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
    equipmentCatalogListResponseSchema,
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
    type ExerciseCatalogItem,
    type ExtensibleCatalogItem,
    type MuscleCatalogItem,
    type TagCatalogItem,
    type TrainingCatalogQueries,
} from "#src/modules/training/application/index";

@ApiTags("training catalog")
@Controller({ path: "training/catalog", version: "1" })
export class TrainingCatalogController {
    constructor(
        @Inject(TRAINING_CATALOG_QUERIES)
        private readonly queries: TrainingCatalogQueries,
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
    async listExercises(): Promise<ExerciseCatalogListResponse> {
        return exerciseCatalogListResponseSchema.parse({
            schemaVersion: 1,
            items: (await this.queries.listExercises()).map(mapExercise),
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

function mapExercise(item: ExerciseCatalogItem): ExerciseCatalogItemResponse {
    return {
        schemaVersion: 1,
        ...item,
        equipment: mapExtensible(item.equipment),
        movementPattern: mapExtensible(item.movementPattern),
        muscles: item.muscles.map(assignment => ({
            muscle: mapMuscle(assignment.muscle),
            role: assignment.role,
        })),
        tags: item.tags.map(mapTag),
        aliases: [...item.aliases],
        supportedMeasurements: [...item.supportedMeasurements],
    };
}
