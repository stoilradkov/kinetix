import { createFileRoute } from "@tanstack/react-router";

import { ActiveWorkout } from "@/components/training/active/active-workout";

export const Route = createFileRoute("/training/sessions/$id")({ component: ActiveWorkoutPage });

function ActiveWorkoutPage(): React.JSX.Element {
    const { id } = Route.useParams();
    return (
        <main>
            <ActiveWorkout sessionId={id} />
        </main>
    );
}
