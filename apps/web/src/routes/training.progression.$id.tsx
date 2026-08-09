import { createFileRoute } from "@tanstack/react-router";

import { ProgressionEvaluationDetailRoute } from "@/components/training/progression-evaluation-detail";

export const Route = createFileRoute("/training/progression/$id")({ component: EvaluationPage });

function EvaluationPage(): React.JSX.Element {
    const { id } = Route.useParams();
    return (
        <main>
            <ProgressionEvaluationDetailRoute evaluationId={id} />
        </main>
    );
}
