import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "#src/schema/index";

export function createDatabase(url: string) {
    const client = postgres(url, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
    });
    const db = drizzle(client, { schema });

    return { client, db };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection["db"];

export { seedModuleInstances, trainingModuleInstanceSeed } from "#src/seed/module-instances";
export * from "#src/schema/index";
