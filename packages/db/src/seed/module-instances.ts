import type { Database } from "#src/index";
import { moduleInstances } from "#src/schema/platform";

export const trainingModuleInstanceSeed = {
    id: "00000000-0000-4000-8000-000000000001",
    moduleType: "training",
    name: "Training",
    slug: "training",
    status: "active",
    settings: {},
} as const;

export async function seedModuleInstances(database: Database): Promise<void> {
    await database
        .insert(moduleInstances)
        .values(trainingModuleInstanceSeed)
        .onConflictDoNothing({ target: moduleInstances.slug });
}
