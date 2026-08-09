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
export * from "#src/modules/training/application/equipment-increments";
export * from "#src/modules/training/application/gear-items";
export * from "#src/modules/training/application/training-goals";
export * from "#src/modules/training/application/training-injuries";
export * from "#src/modules/training/application/training-maxes";
export * from "#src/modules/training/application/zones";
export * from "#src/modules/training/application/session-prescriptions";
export * from "#src/modules/training/application/training-profile";
export * from "#src/modules/training/application/workout-templates";
export * from "#src/modules/training/application/planned-sessions";
export * from "#src/modules/training/application/training-sessions";
export * from "#src/modules/training/application/running-activities";
export * from "#src/modules/training/application/session-to-prescription";
export * from "#src/modules/training/application/programs";
export * from "#src/modules/training/application/bulk-program";
export * from "#src/modules/training/application/import-batches";
export * from "#src/modules/training/application/storage-reconciliation";
export * from "#src/modules/training/application/historical-import";
export * from "#src/modules/training/application/adherence";
export * from "#src/modules/training/application/adherence-queries";
