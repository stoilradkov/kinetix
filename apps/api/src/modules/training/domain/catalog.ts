export const exerciseClassifications = ["compound", "isolation"] as const;
export const exerciseLateralities = ["bilateral", "unilateral"] as const;
export const repetitionSemantics = ["total", "per_side", "alternating"] as const;
export const exerciseLoadModels = [
    "external_only",
    "full_bodyweight_plus_added_minus_assistance",
    "manual_effective_load",
    "none",
] as const;
export const exerciseMeasurementTypes = [
    "repetitions",
    "external_load",
    "bodyweight",
    "added_load",
    "assistance",
    "effective_load",
    "duration",
    "distance",
    "power",
] as const;

export type ExerciseClassification = (typeof exerciseClassifications)[number];
export type ExerciseLaterality = (typeof exerciseLateralities)[number];
export type RepetitionSemantics = (typeof repetitionSemantics)[number];
export type ExerciseLoadModel = (typeof exerciseLoadModels)[number];
export type ExerciseMeasurementType = (typeof exerciseMeasurementTypes)[number];

export interface CatalogTaxonomySeed {
    readonly slug: string;
    readonly name: string;
    readonly position: number;
}

export type MuscleGroupSeed = CatalogTaxonomySeed;

export type EquipmentTypeSeed = CatalogTaxonomySeed;

export type MovementPatternSeed = CatalogTaxonomySeed;

export interface TagSeed extends CatalogTaxonomySeed {
    readonly category: "run_classification";
}

export interface ExerciseSeed {
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly equipmentSlug: string;
    readonly movementPatternSlug: string;
    readonly classification: ExerciseClassification;
    readonly laterality: ExerciseLaterality;
    readonly bodyPosition: string;
    readonly repetitionSemantics: RepetitionSemantics;
    readonly loadModel: ExerciseLoadModel;
    readonly supportedMeasurements: readonly ExerciseMeasurementType[];
    readonly primaryMuscleSlugs: readonly string[];
    readonly secondaryMuscleSlugs: readonly string[];
    readonly tagSlugs: readonly string[];
    readonly notes: string | null;
    readonly position: number;
}

export interface TrainingCatalogSeed {
    readonly schemaVersion: 1;
    readonly muscles: readonly MuscleGroupSeed[];
    readonly equipment: readonly EquipmentTypeSeed[];
    readonly movementPatterns: readonly MovementPatternSeed[];
    readonly tags: readonly TagSeed[];
    readonly exercises: readonly ExerciseSeed[];
}

export class CatalogSeedValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CatalogSeedValidationError";
    }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOAD_MEASUREMENTS = new Set<ExerciseMeasurementType>([
    "external_load",
    "bodyweight",
    "added_load",
    "assistance",
    "effective_load",
]);

export function normalizeCatalogValue(value: string): string {
    return value.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function validateTrainingCatalogSeed(seed: TrainingCatalogSeed): void {
    if (seed.schemaVersion !== 1) throw new CatalogSeedValidationError("Unsupported catalog seed schema version");

    validateTaxonomy("muscle", seed.muscles);
    validateTaxonomy("equipment", seed.equipment);
    validateTaxonomy("movement pattern", seed.movementPatterns);
    validateTaxonomy("tag", seed.tags);
    validateTaxonomy("exercise", seed.exercises);

    const muscles = new Set(seed.muscles.map(item => item.slug));
    const equipment = new Set(seed.equipment.map(item => item.slug));
    const movementPatterns = new Set(seed.movementPatterns.map(item => item.slug));
    const tags = new Set(seed.tags.map(item => item.slug));
    const aliases = new Map<string, string>();

    for (const exercise of seed.exercises) {
        if (!equipment.has(exercise.equipmentSlug))
            invalid(exercise.slug, `references unknown equipment '${exercise.equipmentSlug}'`);
        if (!movementPatterns.has(exercise.movementPatternSlug))
            invalid(exercise.slug, `references unknown movement pattern '${exercise.movementPatternSlug}'`);
        if (exercise.primaryMuscleSlugs.length === 0) invalid(exercise.slug, "must have at least one primary muscle");

        assertReferences(exercise.slug, "primary muscle", exercise.primaryMuscleSlugs, muscles);
        assertReferences(exercise.slug, "secondary muscle", exercise.secondaryMuscleSlugs, muscles);
        assertReferences(exercise.slug, "tag", exercise.tagSlugs, tags);
        assertUnique(exercise.slug, "primary muscle", exercise.primaryMuscleSlugs);
        assertUnique(exercise.slug, "secondary muscle", exercise.secondaryMuscleSlugs);
        assertUnique(exercise.slug, "tag", exercise.tagSlugs);

        const primary = new Set(exercise.primaryMuscleSlugs);
        const overlap = exercise.secondaryMuscleSlugs.find(slug => primary.has(slug));
        if (overlap) invalid(exercise.slug, `assigns muscle '${overlap}' as both primary and secondary`);

        const measurementSet = new Set(exercise.supportedMeasurements);
        if (measurementSet.size !== exercise.supportedMeasurements.length)
            invalid(exercise.slug, "contains duplicate supported measurements");
        validateLoadModel(exercise, measurementSet);

        const exerciseAliases = new Set<string>();
        for (const alias of [exercise.name, ...exercise.aliases]) {
            const normalized = normalizeCatalogValue(alias);
            if (normalized.length === 0) invalid(exercise.slug, "contains an empty alias");
            if (exerciseAliases.has(normalized)) invalid(exercise.slug, `contains duplicate alias '${normalized}'`);
            const owner = aliases.get(normalized);
            if (owner && owner !== exercise.slug)
                invalid(exercise.slug, `shares normalized alias '${normalized}' with '${owner}'`);
            exerciseAliases.add(normalized);
            aliases.set(normalized, exercise.slug);
        }
    }
}

function validateTaxonomy(
    kind: string,
    items: readonly Pick<CatalogTaxonomySeed, "slug" | "name" | "position">[],
): void {
    const slugs = new Set<string>();
    const names = new Set<string>();
    const positions = new Set<number>();
    for (const item of items) {
        if (!SLUG_PATTERN.test(item.slug)) throw new CatalogSeedValidationError(`Invalid ${kind} slug '${item.slug}'`);
        if (item.name.trim().length === 0) throw new CatalogSeedValidationError(`${kind} '${item.slug}' has no name`);
        if (!Number.isSafeInteger(item.position) || item.position < 0)
            throw new CatalogSeedValidationError(`${kind} '${item.slug}' has an invalid position`);
        if (slugs.has(item.slug)) throw new CatalogSeedValidationError(`Duplicate ${kind} slug '${item.slug}'`);
        const name = normalizeCatalogValue(item.name);
        if (names.has(name)) throw new CatalogSeedValidationError(`Duplicate normalized ${kind} name '${name}'`);
        if (positions.has(item.position))
            throw new CatalogSeedValidationError(`Duplicate ${kind} position '${item.position}'`);
        slugs.add(item.slug);
        names.add(name);
        positions.add(item.position);
    }
}

function validateLoadModel(exercise: ExerciseSeed, measurements: ReadonlySet<ExerciseMeasurementType>): void {
    const loadMeasurements = [...measurements].filter(item => LOAD_MEASUREMENTS.has(item));
    switch (exercise.loadModel) {
        case "external_only":
            if (!measurements.has("external_load") || loadMeasurements.some(item => item !== "external_load"))
                invalid(exercise.slug, "external_only requires only external_load among load measurements");
            break;
        case "full_bodyweight_plus_added_minus_assistance":
            if (
                !measurements.has("bodyweight") ||
                loadMeasurements.some(item => !["bodyweight", "added_load", "assistance"].includes(item))
            )
                invalid(
                    exercise.slug,
                    "full_bodyweight_plus_added_minus_assistance requires bodyweight and compatible load measurements",
                );
            break;
        case "manual_effective_load":
            if (
                !measurements.has("effective_load") ||
                loadMeasurements.some(
                    item => !["bodyweight", "added_load", "assistance", "effective_load"].includes(item),
                )
            )
                invalid(
                    exercise.slug,
                    "manual_effective_load requires effective_load and compatible load measurements",
                );
            break;
        case "none":
            if (loadMeasurements.length > 0) invalid(exercise.slug, "none cannot declare load measurements");
            break;
    }
}

function assertReferences(
    owner: string,
    kind: string,
    values: readonly string[],
    available: ReadonlySet<string>,
): void {
    const missing = values.find(value => !available.has(value));
    if (missing) invalid(owner, `references unknown ${kind} '${missing}'`);
}

function assertUnique(owner: string, kind: string, values: readonly string[]): void {
    if (new Set(values).size !== values.length) invalid(owner, `contains duplicate ${kind} references`);
}

function invalid(slug: string, message: string): never {
    throw new CatalogSeedValidationError(`Exercise '${slug}' ${message}`);
}
