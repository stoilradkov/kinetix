import type { KinetixModuleDefinition } from "#src/platform/application/index";

export const trainingModuleDefinition = {
    type: "training",
    version: 1,
    displayName: "Training",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;
export * from "#src/modules/training/application/catalog";
export * from "#src/modules/training/application/exercises";
export * from "#src/modules/training/application/exercise-merges";
export * from "#src/modules/training/application/measurement-mapper";
export * from "#src/modules/training/application/training-goals";
export * from "#src/modules/training/application/training-profile";
