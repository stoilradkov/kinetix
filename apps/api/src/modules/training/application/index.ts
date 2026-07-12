import type { KinetixModuleDefinition } from "#src/platform/application/index.js";

export const trainingModuleDefinition = {
    type: "training",
    version: 1,
    displayName: "Training",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;
