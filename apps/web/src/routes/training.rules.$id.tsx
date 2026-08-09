import { createFileRoute } from "@tanstack/react-router";

import { ProgressionRuleDetailRoute } from "@/components/training/progression-rule-detail";

export const Route = createFileRoute("/training/rules/$id")({ component: RulePage });

function RulePage(): React.JSX.Element {
    const { id } = Route.useParams();
    return (
        <main>
            <ProgressionRuleDetailRoute ruleId={id} />
        </main>
    );
}
