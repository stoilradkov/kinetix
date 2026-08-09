import { createFileRoute } from "@tanstack/react-router";

import { ProgramDetailRoute } from "@/components/training/program-detail";

export const Route = createFileRoute("/training/programs/$id")({ component: ProgramPage });

function ProgramPage(): React.JSX.Element {
    const { id } = Route.useParams();
    return <ProgramDetailRoute programId={id} />;
}
