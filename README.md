# Kinetix

Production-shaped TypeScript monorepo for the Kinetix web application, API, and
`kin` CLI.

## Stack

- **API:** NestJS 11, Drizzle ORM, PostgreSQL, Zod, Swagger/OpenAPI
- **Web:** React 19, Vite, TanStack Router/Query/Table, shadcn/ui, Tailwind CSS,
  React Hook Form
- **CLI:** Commander, Chalk, Zod, TypeScript
- **Tooling:** pnpm workspaces, Turborepo, ESLint flat config, Prettier, Vitest
- **Delivery:** GitHub Actions, Docker Compose, production multi-stage API image

## Requirements

- Node.js 22.13 or newer in the Node 22 release line
- pnpm 11.11.0 (Corepack selects it from `packageManager`)
- Docker with Compose for the local PostgreSQL service

## Get started

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The web application runs at <http://localhost:5173>, the API at
<http://localhost:3000/api/v1>, and Swagger UI at
<http://localhost:3000/api/docs>.

Build the CLI once, then invoke it through the root shortcut:

```bash
pnpm --filter @kinetix/kin build
pnpm kin info
pnpm kin api status
```

## Workspace

```text
apps/
  api/       NestJS HTTP API
  web/       Vite + React application
  kin/       kin command-line application
packages/
  config/    validated runtime configuration
  db/        Drizzle client, schema, and migrations
  types/     shared Zod contracts and TypeScript types
```

## Common commands

| Command                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `pnpm dev`                       | Run all development processes through Turborepo |
| `pnpm check`                     | Format check, lint, type-check, test, and build |
| `pnpm db:generate`               | Generate a migration after schema changes       |
| `pnpm db:migrate`                | Apply pending database migrations               |
| `pnpm db:studio`                 | Open Drizzle Studio                             |
| `pnpm --filter @kinetix/web dev` | Run only the frontend                           |
| `pnpm --filter @kinetix/api dev` | Run only the API                                |
| `pnpm --filter @kinetix/kin dev` | Run the CLI in watch mode                       |

Environment files are intentionally ignored. Copy the root `.env.example` for
the standard local setup. The API validates required configuration at startup;
the API and CLI also include focused examples for isolated use.

## Container image

Build the API from the repository root so the workspace packages are available:

```bash
docker build -f apps/api/Dockerfile -t kinetix-api .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/kinetix \
  -e CORS_ORIGINS=https://app.example.com \
  kinetix-api
```

The final image runs as the unprivileged `node` user, uses `dumb-init` for signal
handling, exposes a container health check, and contains production dependencies
only. Kubernetes can use these existing endpoints later:

- Liveness: `/api/v1/health`
- Readiness: `/api/v1/health/ready`

The Vite app is built independently and is intended for a static host or CDN.

## Database changes

Edit `packages/db/src/schema.ts`, generate a migration, inspect the SQL, and
commit the generated files:

```bash
pnpm db:generate
pnpm db:migrate
```
