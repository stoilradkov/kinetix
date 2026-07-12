import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Boxes } from "lucide-react";

interface RouterContext {
    queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootComponent,
});

function RootComponent(): React.JSX.Element {
    const { queryClient } = Route.useRouteContext();

    return (
        <QueryClientProvider client={queryClient}>
            <div className="bg-background text-foreground min-h-screen">
                <header className="bg-background/80 border-b backdrop-blur">
                    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                        <Link className="flex items-center gap-2 font-semibold" to="/">
                            <span className="bg-foreground text-background grid size-8 place-items-center rounded-lg">
                                <Boxes className="size-4" />
                            </span>
                            kinetix
                        </Link>
                        <nav className="flex items-center gap-1 text-sm">
                            <Link
                                activeProps={{ className: "bg-muted text-foreground" }}
                                className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 transition-colors"
                                to="/"
                            >
                                Overview
                            </Link>
                            <Link
                                activeProps={{ className: "bg-muted text-foreground" }}
                                className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 transition-colors"
                                to="/about"
                            >
                                Stacks
                            </Link>
                        </nav>
                    </div>
                </header>
                <Outlet />
            </div>
            {import.meta.env.DEV ? (
                <>
                    <ReactQueryDevtools initialIsOpen={false} />
                    <TanStackRouterDevtools position="bottom-right" />
                </>
            ) : null}
        </QueryClientProvider>
    );
}
