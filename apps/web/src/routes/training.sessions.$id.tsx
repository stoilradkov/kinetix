import { createFileRoute } from "@tanstack/react-router";

import { SessionDetailRoute } from "@/components/training/session-detail";

export const Route = createFileRoute("/training/sessions/$id")({ component: SessionPage });

function SessionPage(): React.JSX.Element {
    const { id } = Route.useParams();
    return (
        <main>
            <SessionDetailRoute sessionId={id} />
        </main>
    );
}
