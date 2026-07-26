<!-- Keep this file identical to CLAUDE.md. -->

# Kinetix — agent guide

Production-shaped TypeScript monorepo (pnpm workspaces + Turborepo). Read this
before making changes; see [`README.md`](README.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detail.

## Layout

```
apps/
  api/   NestJS HTTP API
  web/   Vite + React app
  kin/   kin CLI
packages/
  config/  validated runtime configuration
  db/      Drizzle client, schema, migrations
  types/   shared Zod contracts and types
```

## Commands (run from repo root)

| Command            | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `pnpm dev`         | Run all dev processes via Turborepo             |
| `pnpm check`       | Format check, lint, type-check, test, and build |
| `pnpm lint`        | ESLint (`--max-warnings=0`)                     |
| `pnpm typecheck`   | Type-check all packages                         |
| `pnpm format`      | Prettier write · `pnpm format:check` to verify  |
| `pnpm db:generate` | Generate a migration after editing the schema   |
| `pnpm db:migrate`  | Apply pending migrations                        |

**Before finishing any change, `pnpm check` must pass** (or at minimum lint,
typecheck, format:check, and the build for the package you touched).

## Working on the web app / any UI

The web app follows the **Kinetic Calm** design system. Before writing or
changing UI, read:

- [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — the rules (identical to
  `apps/web/CLAUDE.md`).
- [`docs/design/DESIGN_SYSTEM.md`](docs/design/DESIGN_SYSTEM.md) — full token and
  component reference.

Short version: **use design tokens, never hardcoded colours** (`bg-blue-500` and
raw hex are not allowed); green = primary/everyday success, amber-gold =
**rare** milestones only; use `Badge`/`Button` primitives; add missing shadcn
components with the CLI rather than hand-rolling them.

## Database changes

Edit `packages/db/src/schema.ts`, run `pnpm db:generate`, inspect the generated
SQL, then commit the migration files.
