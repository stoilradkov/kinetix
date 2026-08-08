import { normalizeGeneralExerciseName } from "#src/catalog-mapping";
import type { CanonicalExerciseReview, ExerciseCatalogSnapshot, SourceExercise } from "#src/model";

const CANONICAL_NAME_OVERRIDES: Readonly<Record<string, string>> = {
    "back row": "chest supported machine row",
    "back squat": "barbell back squat",
    "bench press": "barbell bench press",
    deadlift: "barbell deadlift",
    dips: "parallel bar dip",
    "dumbbell incline bench": "dumbbell incline bench press",
    "incline dumbbell bench": "dumbbell incline bench press",
    "dumbbell lateral raises": "dumbbell lateral raise",
    "dumbbell row": "one arm dumbbell row",
    "one hand dumbbell row": "one arm dumbbell row",
    "one hand row": "one arm dumbbell row",
    "one arm press": "one arm dumbbell shoulder press",
    "one arm dumbbell shoulder press": "one arm dumbbell shoulder press",
    "face pulls": "cable face pull",
    "hamstring slides": "hamstring slide",
    "medicine ball throws": "medicine ball throw",
    "nordic curls": "nordic curl",
    "overhead tricep extension": "overhead triceps extension",
    "overhead tricep extensions": "overhead triceps extension",
    "overhead triceps": "overhead triceps extension",
    "rope triceps pushdown": "cable triceps pushdown",
    "triceps rope pushdown": "cable triceps pushdown",
    "seated biceps curls": "seated biceps curl",
    "machine row": "machine row",
    "row machine": "machine row",
    "lat pull down": "cable lat pulldown",
    "pull down close grip": "cable lat pulldown",
    "pull down machine": "cable lat pulldown",
    "pull down medium grip": "cable lat pulldown",
    "pull down neutral grip": "cable lat pulldown",
    "pull down wide grip": "cable lat pulldown",
    "neutral grip pull up": "pull up",
    "ring pull up": "ring pull up",
    "dumbbell shoulder press": "dumbbell shoulder press",
    "shoulder press": "dumbbell shoulder press",
    "seated dumbbell overhead press": "dumbbell shoulder press",
    "dumbbell rear delt": "dumbbell rear delt fly",
    "face pull": "cable face pull",
    "cable flys": "cable chest fly",
    "chest push machine": "machine chest press",
    "machine fly": "machine chest fly",
    "machine rear delts": "machine reverse fly",
    "bicep cable curls": "cable biceps curl",
    "bicep curl": "machine biceps curl",
    "bicep curls": "machine biceps curl",
    biceps: "dumbbell biceps curl",
    "biceps curl": "barbell biceps curl",
    "biceps cable pull": "cable biceps curl",
    "rope biceps curl": "cable biceps curl",
    "barbell curl": "barbell biceps curl",
    "standing barbell curls": "barbell biceps curl",
    "cambered bar curls": "ez bar biceps curl",
    "hammer curls": "dumbbell hammer curl",
    "incline dumbbell curl": "dumbbell incline curl",
    "seated incline dumbbell curl": "dumbbell incline curl",
    "calf raises": "dumbbell calf raise",
    "standing calf raises": "machine standing calf raise",
    lunges: "barbell lunge",
    "laying leg curl": "machine lying leg curl",
    "unilateral laying leg curl": "single leg machine lying leg curl",
    "unilateral standing leg curl": "single leg machine standing leg curl",
    "unilateral leg extension": "single leg machine leg extension",
    "one leg leg extension": "single leg machine leg extension",
    "bulgarian split squat": "dumbbell bulgarian split squat",
    "romanian deadlift": "barbell romanian deadlift",
    "kettlebell swings": "kettlebell swing",
    "push up": "push up",
    "pull up": "pull up",
    "front squat": "barbell front squat",
    "hip thrust": "barbell hip thrust",
    "leg extension": "machine leg extension",
    "leg press": "machine leg press",
    "overhead press": "barbell overhead press",
    "triceps pushdown": "cable triceps pushdown",
    plank: "forearm plank",
    pullover: "cable pullover",
};

const CATALOG_SLUGS: Readonly<Record<string, string>> = {
    "barbell back squat": "barbell-back-squat",
    "barbell bench press": "barbell-bench-press",
    "barbell deadlift": "barbell-deadlift",
    "barbell front squat": "barbell-front-squat",
    "barbell hip thrust": "barbell-hip-thrust",
    "barbell overhead press": "barbell-overhead-press",
    "barbell romanian deadlift": "barbell-romanian-deadlift",
    "cable lat pulldown": "cable-lat-pulldown",
    "cable triceps pushdown": "cable-triceps-pushdown",
    "dumbbell bulgarian split squat": "dumbbell-bulgarian-split-squat",
    "dumbbell biceps curl": "dumbbell-biceps-curl",
    "forearm plank": "forearm-plank",
    "kettlebell swing": "kettlebell-swing",
    "machine leg extension": "machine-leg-extension",
    "machine leg press": "machine-leg-press",
    "machine standing calf raise": "machine-standing-calf-raise",
    "parallel bar dip": "parallel-bar-dip",
    "pull up": "pull-up",
    "push up": "push-up",
};

const REVIEW_REASONS: Readonly<Record<string, string>> = {};

export function canonicalizeSourceExerciseName(rawName: string): string {
    const normalized = normalizeGeneralExerciseName(rawName);
    return CANONICAL_NAME_OVERRIDES[normalized] ?? normalized;
}

export function catalogSlugForCanonicalName(canonicalName: string): string | null {
    return CATALOG_SLUGS[canonicalName] ?? null;
}

export function buildCanonicalExerciseReview(
    exercises: readonly SourceExercise[],
    catalog: ExerciseCatalogSnapshot,
): CanonicalExerciseReview[] {
    const groups = new Map<string, SourceExercise[]>();
    for (const exercise of exercises) {
        const key = canonicalizeSourceExerciseName(exercise.rawName);
        const values = groups.get(key) ?? [];
        values.push(exercise);
        groups.set(key, values);
    }

    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([canonicalName, values]) => {
            const reviewReason = REVIEW_REASONS[canonicalName];
            const slug = catalogSlugForCanonicalName(canonicalName);
            const catalogItem = slug ? catalog.items.find(item => item.slug === slug) : undefined;
            return {
                canonicalName,
                sourceLabels: [...new Set(values.map(value => value.rawName))].sort(),
                occurrences: values.length,
                status: reviewReason ? "needs_review" : catalogItem ? "catalog" : "proposed",
                catalogExerciseId: catalogItem?.id ?? null,
                catalogSlug: catalogItem?.slug ?? null,
                reason:
                    reviewReason ??
                    (catalogItem
                        ? `Resolved to existing catalog exercise ${catalogItem.name}`
                        : "Create one normalized custom exercise definition"),
                examples: values.slice(0, 5).map(value => ({
                    sourceId: `${value.sheet}!${value.performanceCell}`,
                    rawPerformance: value.rawPerformance ?? "",
                })),
            };
        });
}
