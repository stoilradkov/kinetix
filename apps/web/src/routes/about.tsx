import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

const groups = [
  ['Backend', 'NestJS · Drizzle ORM · PostgreSQL · OpenAPI'],
  ['Frontend', 'React · Vite · TanStack · shadcn/ui · Tailwind CSS'],
  ['Tooling', 'pnpm · Turborepo · TypeScript · ESLint · Prettier · Vitest'],
  ['Delivery', 'Multi-stage Docker · non-root runtime · GitHub Actions'],
];

function AboutPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm font-medium text-emerald-600">The stack</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Conventional where it matters.
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
        Each layer is independently buildable and deployable, while shared
        packages keep contracts and configuration aligned.
      </p>
      <dl className="bg-card mt-10 divide-y rounded-xl border px-6 shadow-sm">
        {groups.map(([label, value]) => (
          <div className="grid gap-2 py-5 sm:grid-cols-4" key={label}>
            <dt className="font-medium">{label}</dt>
            <dd className="text-muted-foreground sm:col-span-3">{value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
