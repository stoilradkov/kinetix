## Repo workflow

Backend features live in:

apps/api/src/modules/<feature>/
domain/ Pure TypeScript business rules
application/ Use cases, ports, public interfaces
infrastructure/ Database and external-service adapters
presentation/ Controllers and wire mapping
<feature>.module.ts
index.ts Public module API

Dependency direction is:

presentation/infrastructure → application → domain

Use #src/... for Node workspace imports and @/... in the web app. Other modules should only import a module’s public index.ts.

Database work:

1. Add tables to packages/db/src/schema/<owner>.ts.
2. Generate a migration with pnpm db:generate.
3. Review the generated SQL in packages/db/drizzle/.
4. Test locally with pnpm db:migrate.
5. Add idempotent seeds under packages/db/src/seed/.

Other locations:

- API contracts/Zod schemas: packages/types/src/
- Web features: apps/web/src/features/<feature>/
- CLI commands: apps/kin/src/commands/<feature>/
- Shared configuration: packages/config/

Tests live beside each workspace’s test/ folder:

- Domain/application unit tests: apps/api/test/
- Database/migration tests: packages/db/test/
- Contract tests: packages/types/test/
- Web tests: near the tested source or in its feature folder
- CLI tests: apps/kin/test/

Typical sequence:

1. Write the failing test.
2. Implement domain behavior.
3. Add the application use case and ports.
4. Add infrastructure/schema/migration.
5. Add controller/contracts, then web or CLI integration.
6. Run pnpm check before finishing.
