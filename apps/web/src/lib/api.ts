import { queryOptions } from "@tanstack/react-query";

import {
    apiErrorSchema,
    coreProfileResponseSchema,
    createProfileRequestSchema,
    updateProfileRequestSchema,
    type CoreProfileResponse,
    createTrainingProfileRequestSchema,
    trainingProfileResponseSchema,
    updateTrainingProfileRequestSchema,
    type TrainingProfileResponse,
    createTrainingGoalRequestSchema,
    trainingGoalListResponseSchema,
    trainingGoalResponseSchema,
    updateTrainingGoalRequestSchema,
    type TrainingGoalResponse,
    createTrainingInjuryRequestSchema,
    trainingInjuryListResponseSchema,
    trainingInjuryResponseSchema,
    updateTrainingInjuryRequestSchema,
    type TrainingInjuryResponse,
    createExerciseRequestSchema,
    equipmentCatalogListResponseSchema,
    exerciseCatalogItemSchema,
    exerciseCatalogListResponseSchema,
    exerciseMergeHistoryResponseSchema,
    exerciseMergePreviewRequestSchema,
    exerciseMergePreviewResponseSchema,
    exerciseMergeResourceSchema,
    mergeExerciseRequestSchema,
    movementPatternCatalogListResponseSchema,
    muscleCatalogListResponseSchema,
    replaceExerciseAliasesRequestSchema,
    replaceExerciseMusclesRequestSchema,
    replaceExerciseRelationshipsRequestSchema,
    revisionHistoryResponseSchema,
    updateExerciseRequestSchema,
    type ExerciseCatalogItemResponse,
    type ExerciseMergeResource,
} from "@kinetix/types";
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

export const profileQueryOptions = queryOptions({
    queryKey: ["profile"],
    queryFn: async (): Promise<CoreProfileResponse | null> => {
        const response = await fetch(`${apiUrl}/profile`);
        if (response.status === 404) return null;
        const body: unknown = await response.json();
        if (!response.ok) {
            const parsed = apiErrorSchema.safeParse(body);
            throw new Error(
                parsed.success ? parsed.data.message : `Kinetix API request failed with HTTP ${response.status}`,
            );
        }
        return coreProfileResponseSchema.parse(body);
    },
});

export async function createProfile(input: unknown): Promise<CoreProfileResponse> {
    return coreProfileResponseSchema.parse(
        await apiRequest("/profile", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createProfileRequestSchema.parse(input)),
        }),
    );
}

export async function updateProfile(profile: CoreProfileResponse, input: unknown): Promise<CoreProfileResponse> {
    return coreProfileResponseSchema.parse(
        await apiRequest("/profile", {
            method: "PATCH",
            headers: mutationHeaders(profile.version, crypto.randomUUID()),
            body: JSON.stringify(updateProfileRequestSchema.parse(input)),
        }),
    );
}

export const trainingProfileQueryOptions = queryOptions({
    queryKey: ["training-profile"],
    queryFn: async (): Promise<TrainingProfileResponse | null> => {
        const response = await fetch(`${apiUrl}/training/profile`);
        if (response.status === 404) return null;
        const body: unknown = await response.json();
        if (!response.ok) {
            const parsed = apiErrorSchema.safeParse(body);
            throw new Error(
                parsed.success ? parsed.data.message : `Kinetix API request failed with HTTP ${response.status}`,
            );
        }
        return trainingProfileResponseSchema.parse(body);
    },
});

export async function createTrainingProfile(input: unknown): Promise<TrainingProfileResponse> {
    return trainingProfileResponseSchema.parse(
        await apiRequest("/training/profile", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createTrainingProfileRequestSchema.parse(input)),
        }),
    );
}

export async function updateTrainingProfile(
    profile: TrainingProfileResponse,
    input: unknown,
): Promise<TrainingProfileResponse> {
    return trainingProfileResponseSchema.parse(
        await apiRequest("/training/profile", {
            method: "PATCH",
            headers: mutationHeaders(profile.version, crypto.randomUUID()),
            body: JSON.stringify(updateTrainingProfileRequestSchema.parse(input)),
        }),
    );
}

export const goalsQueryOptions = queryOptions({
    queryKey: ["training-goals"],
    queryFn: async () => trainingGoalListResponseSchema.parse(await apiRequest("/training/goals")),
});

export async function createGoal(input: unknown): Promise<TrainingGoalResponse> {
    return trainingGoalResponseSchema.parse(
        await apiRequest("/training/goals", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createTrainingGoalRequestSchema.parse(input)),
        }),
    );
}

export async function updateGoal(goal: TrainingGoalResponse, input: unknown): Promise<TrainingGoalResponse> {
    return trainingGoalResponseSchema.parse(
        await apiRequest(`/training/goals/${encodeURIComponent(goal.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(goal.version, crypto.randomUUID()),
            body: JSON.stringify(updateTrainingGoalRequestSchema.parse(input)),
        }),
    );
}

export const injuriesQueryOptions = queryOptions({
    queryKey: ["training-injuries"],
    queryFn: async () => trainingInjuryListResponseSchema.parse(await apiRequest("/training/injuries")),
});

export async function createInjury(input: unknown): Promise<TrainingInjuryResponse> {
    return trainingInjuryResponseSchema.parse(
        await apiRequest("/training/injuries", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createTrainingInjuryRequestSchema.parse(input)),
        }),
    );
}

export async function updateInjury(injury: TrainingInjuryResponse, input: unknown): Promise<TrainingInjuryResponse> {
    return trainingInjuryResponseSchema.parse(
        await apiRequest(`/training/injuries/${encodeURIComponent(injury.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(injury.version, crypto.randomUUID()),
            body: JSON.stringify(updateTrainingInjuryRequestSchema.parse(input)),
        }),
    );
}

export function exerciseListQueryOptions(search: string, status: "active" | "archived" | "all") {
    return queryOptions({
        queryKey: ["training", "exercises", { search, status }],
        queryFn: async () => {
            const query = new URLSearchParams({ status, limit: "100" });
            if (search.trim()) query.set("search", search.trim());
            return exerciseCatalogListResponseSchema.parse(
                await apiRequest(`/training/catalog/exercises?${query.toString()}`),
            );
        },
    });
}

export const exerciseFormCatalogQueryOptions = queryOptions({
    queryKey: ["training", "exercise-form-catalogs"],
    queryFn: async () => {
        const [equipment, movementPatterns, muscles] = await Promise.all([
            apiRequest("/training/catalog/equipment"),
            apiRequest("/training/catalog/movement-patterns"),
            apiRequest("/training/catalog/muscles"),
        ]);
        return {
            equipment: equipmentCatalogListResponseSchema.parse(equipment).items,
            movementPatterns: movementPatternCatalogListResponseSchema.parse(movementPatterns).items,
            muscles: muscleCatalogListResponseSchema.parse(muscles).items,
        };
    },
});

export function exerciseRevisionHistoryQueryOptions(exerciseId: string | null) {
    return queryOptions({
        queryKey: ["training", "exercise-history", exerciseId],
        enabled: exerciseId !== null,
        queryFn: async () =>
            revisionHistoryResponseSchema.parse(
                await apiRequest(`/history/training.exercise/${encodeURIComponent(exerciseId!)}`),
            ),
    });
}

export function exerciseMergeHistoryQueryOptions(exerciseId: string | null) {
    return queryOptions({
        queryKey: ["training", "exercise-merge-history", exerciseId],
        enabled: exerciseId !== null,
        queryFn: async () =>
            exerciseMergeHistoryResponseSchema.parse(
                await apiRequest(
                    `/training/catalog/exercise-merges/history/${encodeURIComponent(exerciseId!)}?limit=100`,
                ),
            ),
    });
}

export async function createExercise(input: unknown): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest("/training/catalog/exercises", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createExerciseRequestSchema.parse(input)),
        }),
    );
}

export async function updateExercise(
    exercise: ExerciseCatalogItemResponse,
    input: unknown,
): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exercise.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(exercise.version, crypto.randomUUID()),
            body: JSON.stringify(updateExerciseRequestSchema.parse(input)),
        }),
    );
}

export async function replaceExerciseRelationships(
    exercise: ExerciseCatalogItemResponse,
    input: unknown,
): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exercise.id)}/relationships`, {
            method: "PUT",
            headers: mutationHeaders(exercise.version, crypto.randomUUID()),
            body: JSON.stringify(replaceExerciseRelationshipsRequestSchema.parse(input)),
        }),
    );
}

export async function replaceExerciseAliases(
    exercise: ExerciseCatalogItemResponse,
    aliases: readonly string[],
): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exercise.id)}/aliases`, {
            method: "PUT",
            headers: mutationHeaders(exercise.version, crypto.randomUUID()),
            body: JSON.stringify(replaceExerciseAliasesRequestSchema.parse({ aliases })),
        }),
    );
}

export async function replaceExerciseMuscles(
    exercise: ExerciseCatalogItemResponse,
    muscles: readonly { readonly muscleGroupId: string; readonly role: "primary" | "secondary" }[],
): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exercise.id)}/muscles`, {
            method: "PUT",
            headers: mutationHeaders(exercise.version, crypto.randomUUID()),
            body: JSON.stringify(replaceExerciseMusclesRequestSchema.parse({ muscles })),
        }),
    );
}

export async function changeExerciseStatus(
    exercise: ExerciseCatalogItemResponse,
): Promise<ExerciseCatalogItemResponse> {
    const action = exercise.status === "active" ? "archive" : "restore";
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exercise.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(exercise.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export async function previewExerciseMerge(input: unknown) {
    return exerciseMergePreviewResponseSchema.parse(
        await apiRequest("/training/catalog/exercise-merges/preview", {
            method: "POST",
            headers: mutationHeaders(),
            body: JSON.stringify(exerciseMergePreviewRequestSchema.parse(input)),
        }),
    );
}

export async function mergeExercises(input: unknown): Promise<ExerciseMergeResource> {
    return exerciseMergeResourceSchema.parse(
        await apiRequest("/training/catalog/exercise-merges", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(mergeExerciseRequestSchema.parse(input)),
        }),
    );
}

export async function revertExerciseMerge(merge: ExerciseMergeResource): Promise<ExerciseMergeResource> {
    const [canonical, merged] = await Promise.all([
        getExercise(merge.canonicalExercise.id),
        getExercise(merge.mergedExercise.id),
    ]);
    return exerciseMergeResourceSchema.parse(
        await apiRequest(`/training/catalog/exercise-merges/${encodeURIComponent(merge.id)}/revert`, {
            method: "POST",
            headers: mutationHeaders(merge.version, crypto.randomUUID()),
            body: JSON.stringify({
                expectedCanonicalVersion: canonical.version,
                expectedMergedVersion: merged.version,
            }),
        }),
    );
}

async function getExercise(exerciseId: string): Promise<ExerciseCatalogItemResponse> {
    return exerciseCatalogItemSchema.parse(
        await apiRequest(`/training/catalog/exercises/${encodeURIComponent(exerciseId)}`),
    );
}

function mutationHeaders(version?: number, idempotencyKey?: string): Headers {
    const headers = new Headers({ "content-type": "application/json" });
    if (version !== undefined) headers.set("if-match", `"${version}"`);
    if (idempotencyKey !== undefined) headers.set("idempotency-key", idempotencyKey);
    return headers;
}

async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${apiUrl}${path}`, init);
    const body: unknown = await response.json();
    if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        throw new Error(
            parsed.success ? parsed.data.message : `Kinetix API request failed with HTTP ${response.status}`,
        );
    }
    return body;
}
