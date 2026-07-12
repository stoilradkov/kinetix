import type { KinetixModuleDefinition } from "#src/platform/application/index";

export const trainingModuleDefinition = {
    type: "training",
    version: 1,
    displayName: "Training",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;
export * from "#src/modules/training/application/measurement-mapper";
