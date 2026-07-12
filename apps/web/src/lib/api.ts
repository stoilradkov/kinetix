import { queryOptions } from "@tanstack/react-query";

import { healthResponseSchema } from "@kinetix/types";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

export const healthQueryOptions = queryOptions({
    queryKey: ["health"],
    queryFn: async () => {
        const response = await fetch(`${apiUrl}/health`);
        if (!response.ok) {
            throw new Error(`API health check failed with HTTP ${response.status}`);
        }

        return healthResponseSchema.parse(await response.json());
    },
});
