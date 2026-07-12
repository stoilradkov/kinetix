import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const moduleInstanceStatus = pgEnum("module_instance_status", ["active", "disabled", "archived"]);

export const moduleInstances = pgTable(
    "module_instances",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        moduleType: text("module_type").notNull(),
        name: text("name").notNull(),
        slug: text("slug").notNull(),
        status: moduleInstanceStatus("status").notNull().default("active"),
        settings: jsonb("settings").notNull().default({}),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("module_instances_slug_unique").on(table.slug),
        index("module_instances_type_status_idx").on(table.moduleType, table.status),
    ],
);

export type ModuleInstanceRow = typeof moduleInstances.$inferSelect;
export type NewModuleInstanceRow = typeof moduleInstances.$inferInsert;
