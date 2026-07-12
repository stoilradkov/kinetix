import type { KinetixModuleDefinition } from "#src/platform/application/index.js";

export const healthDataModuleDefinition = {
    type: "health-data",
    version: 1,
    displayName: "Health Data",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;
