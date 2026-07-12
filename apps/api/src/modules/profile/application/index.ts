import type { KinetixModuleDefinition } from "#src/platform/application/index";

export const profileModuleDefinition = {
    type: "profile",
    version: 1,
    displayName: "Profile",
    cardinality: "one",
} as const satisfies KinetixModuleDefinition;
