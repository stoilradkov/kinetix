import type {
    EquipmentTypeSeed,
    ExerciseSeed,
    MuscleGroupSeed,
    MovementPatternSeed,
    TagSeed,
    TrainingCatalogSeed,
} from "#src/modules/training/domain/catalog";
import { validateTrainingCatalogSeed } from "#src/modules/training/domain/catalog";
import type { UnitOfWork } from "#src/platform/application/index";
import type { Clock } from "#src/platform/domain/index";

export const TRAINING_CATALOG_SEED_REPOSITORY = Symbol("TRAINING_CATALOG_SEED_REPOSITORY");
export const TRAINING_CATALOG_READER = Symbol("TRAINING_CATALOG_READER");
export const SEED_TRAINING_CATALOG = Symbol("SEED_TRAINING_CATALOG");
export const TRAINING_CATALOG_QUERIES = Symbol("TRAINING_CATALOG_QUERIES");

export type SeedWriteOutcome = "created" | "updated" | "unchanged" | "user_conflict";

export interface CatalogSeedWriteResult {
    readonly outcome: SeedWriteOutcome;
    readonly slug: string;
}

export interface TrainingCatalogSeedRepository {
    upsertMuscle(seed: MuscleGroupSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult>;
    upsertEquipment(seed: EquipmentTypeSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult>;
    upsertMovementPattern(seed: MovementPatternSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult>;
    upsertTag(seed: TagSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult>;
    upsertExercise(seed: ExerciseSeed, now: Date, transaction: unknown): Promise<CatalogSeedWriteResult>;
    archiveRemovedMuscles(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number>;
    archiveRemovedEquipment(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number>;
    archiveRemovedMovementPatterns(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number>;
    archiveRemovedTags(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number>;
    archiveRemovedExercises(activeSlugs: readonly string[], now: Date, transaction: unknown): Promise<number>;
}

export interface SeedTrainingCatalogResult {
    readonly schemaVersion: 1;
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly archived: number;
    readonly userConflicts: readonly string[];
}

export class SeedTrainingCatalog {
    constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly repository: TrainingCatalogSeedRepository,
        private readonly seed: TrainingCatalogSeed,
        private readonly clock: Clock,
    ) {}

    execute(): Promise<SeedTrainingCatalogResult> {
        validateTrainingCatalogSeed(this.seed);
        const now = this.clock.now();
        return this.unitOfWork.execute(async transaction => {
            const archived =
                (await this.repository.archiveRemovedExercises(
                    this.seed.exercises.map(item => item.slug),
                    now,
                    transaction,
                )) +
                (await this.repository.archiveRemovedTags(
                    this.seed.tags.map(item => item.slug),
                    now,
                    transaction,
                )) +
                (await this.repository.archiveRemovedMovementPatterns(
                    this.seed.movementPatterns.map(item => item.slug),
                    now,
                    transaction,
                )) +
                (await this.repository.archiveRemovedEquipment(
                    this.seed.equipment.map(item => item.slug),
                    now,
                    transaction,
                )) +
                (await this.repository.archiveRemovedMuscles(
                    this.seed.muscles.map(item => item.slug),
                    now,
                    transaction,
                ));

            const writes: CatalogSeedWriteResult[] = [];
            for (const muscle of this.seed.muscles)
                writes.push(await this.repository.upsertMuscle(muscle, now, transaction));
            for (const equipment of this.seed.equipment)
                writes.push(await this.repository.upsertEquipment(equipment, now, transaction));
            for (const movementPattern of this.seed.movementPatterns)
                writes.push(await this.repository.upsertMovementPattern(movementPattern, now, transaction));
            for (const tag of this.seed.tags) writes.push(await this.repository.upsertTag(tag, now, transaction));
            for (const exercise of this.seed.exercises)
                writes.push(await this.repository.upsertExercise(exercise, now, transaction));

            return {
                schemaVersion: 1,
                created: count(writes, "created"),
                updated: count(writes, "updated"),
                unchanged: count(writes, "unchanged"),
                archived,
                userConflicts: writes.filter(item => item.outcome === "user_conflict").map(item => item.slug),
            };
        });
    }
}

export interface MuscleCatalogItem {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly position: number;
}

export interface ExtensibleCatalogItem extends MuscleCatalogItem {
    readonly ownership: "seeded" | "user";
    readonly analyticsMappingStatus: "standard" | "unmapped";
}

export interface TagCatalogItem extends MuscleCatalogItem {
    readonly ownership: "seeded" | "user";
    readonly category: "run_classification" | "custom";
}

export interface ExerciseCatalogItem {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly status: "active" | "archived";
    readonly ownership: "seeded" | "user";
    readonly equipment: ExtensibleCatalogItem;
    readonly movementPattern: ExtensibleCatalogItem;
    readonly classification: "compound" | "isolation";
    readonly laterality: "bilateral" | "unilateral";
    readonly bodyPosition: string;
    readonly repetitionSemantics: "total" | "per_side" | "alternating";
    readonly loadModel:
        "external_only" | "full_bodyweight_plus_added_minus_assistance" | "manual_effective_load" | "none";
    readonly supportedMeasurements: readonly (
        | "repetitions"
        | "external_load"
        | "bodyweight"
        | "added_load"
        | "assistance"
        | "effective_load"
        | "duration"
        | "distance"
        | "power"
    )[];
    readonly muscles: readonly { readonly muscle: MuscleCatalogItem; readonly role: "primary" | "secondary" }[];
    readonly tags: readonly TagCatalogItem[];
    readonly notes: string | null;
    readonly version: number;
    readonly position: number;
}

export interface TrainingCatalogReader {
    listMuscles(): Promise<readonly MuscleCatalogItem[]>;
    listEquipment(): Promise<readonly ExtensibleCatalogItem[]>;
    listMovementPatterns(): Promise<readonly ExtensibleCatalogItem[]>;
    listTags(): Promise<readonly TagCatalogItem[]>;
    listExercises(): Promise<readonly ExerciseCatalogItem[]>;
}

export class TrainingCatalogQueries {
    constructor(private readonly reader: TrainingCatalogReader) {}

    listMuscles(): Promise<readonly MuscleCatalogItem[]> {
        return this.reader.listMuscles();
    }

    listEquipment(): Promise<readonly ExtensibleCatalogItem[]> {
        return this.reader.listEquipment();
    }

    listMovementPatterns(): Promise<readonly ExtensibleCatalogItem[]> {
        return this.reader.listMovementPatterns();
    }

    listTags(): Promise<readonly TagCatalogItem[]> {
        return this.reader.listTags();
    }

    listExercises(): Promise<readonly ExerciseCatalogItem[]> {
        return this.reader.listExercises();
    }
}

function count(results: readonly CatalogSeedWriteResult[], outcome: SeedWriteOutcome): number {
    return results.filter(result => result.outcome === outcome).length;
}
