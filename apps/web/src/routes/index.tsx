import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Database, TerminalSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { healthQueryOptions } from "@/lib/api";

export const Route = createFileRoute("/")({
    component: HomePage,
});

function HomePage(): React.JSX.Element {
    const health = useQuery(healthQueryOptions);

    return (
        <main className="mx-auto max-w-6xl px-6 py-12">
            <div className="max-w-3xl">
                <Badge variant="success" className="mb-5">
                    <span className="bg-success size-1.5 rounded-full" />
                    Production-shaped from day one
                </Badge>
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ship motion, not setup.</h1>
                <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">
                    kinetix connects a typed NestJS API, PostgreSQL, React, and a real CLI in one fast pnpm workspace.
                </p>
            </div>

            <section className="mt-10 grid gap-4 sm:grid-cols-3">
                <Stat
                    icon={<Activity />}
                    label="API status"
                    value={health.isSuccess ? "Connected" : "Start pnpm dev"}
                />
                <Stat icon={<Database />} label="Data layer" value="Drizzle + PostgreSQL" />
                <Stat icon={<TerminalSquare />} label="CLI" value="kin api status" />
            </section>

            <section className="mt-10 rounded-xl border p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Training foundations</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                    Profile, Health Data, and Training now have isolated backend module boundaries ready for their first
                    capabilities.
                </p>
            </section>
        </main>
    );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.JSX.Element {
    return (
        <div className="bg-card rounded-xl border p-5 shadow-sm">
            <div className="bg-muted text-muted-foreground mb-4 flex size-9 items-center justify-center rounded-lg [&_svg]:size-4">
                {icon}
            </div>
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{label}</p>
            <p className="mt-1 font-medium">{value}</p>
        </div>
    );
}
