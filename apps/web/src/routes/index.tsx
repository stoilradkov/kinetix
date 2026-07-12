import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Activity, Database, TerminalSquare } from 'lucide-react';

import { CreateProjectForm } from '../components/create-project-form';
import { ProjectsTable } from '../components/projects-table';
import { healthQueryOptions } from '../lib/api';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage(): React.JSX.Element {
  const health = useQuery(healthQueryOptions);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="max-w-3xl">
        <div className="text-muted-foreground mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Production-shaped from day one
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Ship motion, not setup.
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">
          kinetix connects a typed NestJS API, PostgreSQL, React, and a real CLI
          in one fast pnpm workspace.
        </p>
      </div>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Activity />}
          label="API status"
          value={health.isSuccess ? 'Connected' : 'Start pnpm dev'}
        />
        <Stat
          icon={<Database />}
          label="Data layer"
          value="Drizzle + PostgreSQL"
        />
        <Stat icon={<TerminalSquare />} label="CLI" value="kin api status" />
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Projects</h2>
            <p className="text-muted-foreground text-sm">
              TanStack Table is ready for server-backed data.
            </p>
          </div>
          <ProjectsTable />
        </section>
        <CreateProjectForm />
      </div>
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="bg-card rounded-xl border p-5 shadow-sm">
      <div className="bg-muted text-muted-foreground mb-4 flex size-9 items-center justify-center rounded-lg [&_svg]:size-4">
        {icon}
      </div>
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
