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
    recordTrainingMaxRequestSchema,
    trainingMaxListResponseSchema,
    trainingMaxResponseSchema,
    type TrainingMaxResponse,
    type TrainingMaxTypeValue,
    recordZoneDefinitionRequestSchema,
    zoneDefinitionListResponseSchema,
    zoneDefinitionResponseSchema,
    type ZoneDefinitionResponse,
    type ZoneFamilyValue,
    createEquipmentIncrementRequestSchema,
    equipmentIncrementListResponseSchema,
    equipmentIncrementResponseSchema,
    updateEquipmentIncrementRequestSchema,
    type EquipmentIncrementResponse,
    createGearItemRequestSchema,
    gearItemListResponseSchema,
    gearItemResponseSchema,
    updateGearItemRequestSchema,
    type GearItemResponse,
    createManualHealthRecordRequestSchema,
    manualHealthRecordListResponseSchema,
    manualHealthRecordResponseSchema,
    updateManualHealthRecordRequestSchema,
    type HealthRecordTypeValue,
    type ManualHealthRecordResponse,
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
    createWorkoutTemplateRequestSchema,
    updateWorkoutTemplateRequestSchema,
    workoutTemplateListResponseSchema,
    workoutTemplateResponseSchema,
    createProgramRequestSchema,
    updateProgramRequestSchema,
    programListResponseSchema,
    programResponseSchema,
    activateProgramRequestSchema,
    activateProgramResponseSchema,
    changeProgramStartDateRequestSchema,
    changeProgramStartDateResponseSchema,
    programSessionsResponseSchema,
    plannedSessionResponseSchema,
    reschedulePlannedSessionRequestSchema,
    skipCancelPlannedSessionRequestSchema,
    createTrainingSessionRequestSchema,
    updateTrainingSessionRequestSchema,
    completeTrainingSessionRequestSchema,
    startPlannedTrainingSessionRequestSchema,
    startEmptyTrainingSessionRequestSchema,
    startTemplateTrainingSessionRequestSchema,
    startPreviousTrainingSessionRequestSchema,
    addSessionActivityRequestSchema,
    reorderSessionActivitiesRequestSchema,
    substituteOccurrenceRequestSchema,
    recordPerformedSetRequestSchema,
    updatePerformedSetRequestSchema,
    recordSessionMappingsRequestSchema,
    activeTrainingSessionResponseSchema,
    completionPreviewResponseSchema,
    trainingSessionListResponseSchema,
    trainingSessionResponseSchema,
    type TrainingSessionResponse,
    type TrainingSessionSummary,
    type ExerciseCatalogItemResponse,
    type ExerciseMergeResource,
    type WorkoutTemplateResponse,
    type WorkoutTemplateSummary,
    type ActivateProgramResponse,
    type ChangeProgramStartDateResponse,
    type PlannedSessionResponse,
    type ProgramResponse,
    type ProgramSummary,
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

export function trainingMaxesQueryOptions(exerciseId?: string) {
    return queryOptions({
        queryKey: ["training-maxes", { exerciseId: exerciseId ?? null }],
        queryFn: async () => {
            const suffix = exerciseId ? `?exerciseId=${encodeURIComponent(exerciseId)}` : "";
            return trainingMaxListResponseSchema.parse(await apiRequest(`/training/maxes${suffix}`));
        },
    });
}

export function trainingMaxHistoryQueryOptions(
    series: { exerciseId: string; maxType: TrainingMaxTypeValue; customLabel: string | null } | null,
) {
    return queryOptions({
        queryKey: ["training-max-history", series],
        enabled: series !== null,
        queryFn: async () => {
            const query = new URLSearchParams({ exerciseId: series!.exerciseId, maxType: series!.maxType });
            if (series!.customLabel) query.set("customLabel", series!.customLabel);
            return trainingMaxListResponseSchema.parse(await apiRequest(`/training/maxes/history?${query.toString()}`));
        },
    });
}

export async function recordTrainingMax(input: unknown): Promise<TrainingMaxResponse> {
    return trainingMaxResponseSchema.parse(
        await apiRequest("/training/maxes", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(recordTrainingMaxRequestSchema.parse(input)),
        }),
    );
}

export const zonesQueryOptions = queryOptions({
    queryKey: ["training-zones"],
    queryFn: async () => zoneDefinitionListResponseSchema.parse(await apiRequest("/training/zones")),
});

export function zoneHistoryQueryOptions(family: ZoneFamilyValue | null) {
    return queryOptions({
        queryKey: ["training-zone-history", family],
        enabled: family !== null,
        queryFn: async () =>
            zoneDefinitionListResponseSchema.parse(
                await apiRequest(`/training/zones/history?family=${encodeURIComponent(family!)}`),
            ),
    });
}

export async function recordZoneDefinition(input: unknown): Promise<ZoneDefinitionResponse> {
    return zoneDefinitionResponseSchema.parse(
        await apiRequest("/training/zones", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(recordZoneDefinitionRequestSchema.parse(input)),
        }),
    );
}

export const equipmentIncrementsQueryOptions = queryOptions({
    queryKey: ["training-equipment-increments"],
    queryFn: async () => equipmentIncrementListResponseSchema.parse(await apiRequest("/training/equipment-increments")),
});

export async function createEquipmentIncrement(input: unknown): Promise<EquipmentIncrementResponse> {
    return equipmentIncrementResponseSchema.parse(
        await apiRequest("/training/equipment-increments", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createEquipmentIncrementRequestSchema.parse(input)),
        }),
    );
}

export async function updateEquipmentIncrement(
    increment: EquipmentIncrementResponse,
    input: unknown,
): Promise<EquipmentIncrementResponse> {
    return equipmentIncrementResponseSchema.parse(
        await apiRequest(`/training/equipment-increments/${encodeURIComponent(increment.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(increment.version, crypto.randomUUID()),
            body: JSON.stringify(updateEquipmentIncrementRequestSchema.parse(input)),
        }),
    );
}

export function gearItemsQueryOptions(includeArchived: boolean) {
    return queryOptions({
        queryKey: ["training-gear", { includeArchived }],
        queryFn: async () => {
            const suffix = includeArchived ? "?includeArchived=true" : "";
            return gearItemListResponseSchema.parse(await apiRequest(`/training/gear${suffix}`));
        },
    });
}

export async function createGearItem(input: unknown): Promise<GearItemResponse> {
    return gearItemResponseSchema.parse(
        await apiRequest("/training/gear", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createGearItemRequestSchema.parse(input)),
        }),
    );
}

export async function updateGearItem(gear: GearItemResponse, input: unknown): Promise<GearItemResponse> {
    return gearItemResponseSchema.parse(
        await apiRequest(`/training/gear/${encodeURIComponent(gear.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(gear.version, crypto.randomUUID()),
            body: JSON.stringify(updateGearItemRequestSchema.parse(input)),
        }),
    );
}

export async function changeGearStatus(gear: GearItemResponse): Promise<GearItemResponse> {
    const action = gear.status === "active" ? "archive" : "restore";
    return gearItemResponseSchema.parse(
        await apiRequest(`/training/gear/${encodeURIComponent(gear.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(gear.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export function healthRecordsQueryOptions(type: HealthRecordTypeValue | "all", includeArchived: boolean) {
    return queryOptions({
        queryKey: ["health-records", { type, includeArchived }],
        queryFn: async () => {
            const query = new URLSearchParams();
            if (type !== "all") query.set("type", type);
            if (includeArchived) query.set("includeArchived", "true");
            const suffix = query.size > 0 ? `?${query.toString()}` : "";
            return manualHealthRecordListResponseSchema.parse(await apiRequest(`/health/records${suffix}`));
        },
    });
}

export async function createHealthRecord(input: unknown): Promise<ManualHealthRecordResponse> {
    return manualHealthRecordResponseSchema.parse(
        await apiRequest("/health/records", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createManualHealthRecordRequestSchema.parse(input)),
        }),
    );
}

export async function updateHealthRecord(
    record: ManualHealthRecordResponse,
    input: unknown,
): Promise<ManualHealthRecordResponse> {
    return manualHealthRecordResponseSchema.parse(
        await apiRequest(`/health/records/${encodeURIComponent(record.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(record.version, crypto.randomUUID()),
            body: JSON.stringify(updateManualHealthRecordRequestSchema.parse(input)),
        }),
    );
}

export async function archiveHealthRecord(record: ManualHealthRecordResponse): Promise<ManualHealthRecordResponse> {
    return manualHealthRecordResponseSchema.parse(
        await apiRequest(`/health/records/${encodeURIComponent(record.id)}/archive`, {
            method: "POST",
            headers: mutationHeaders(record.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export function workoutTemplatesQueryOptions(includeArchived: boolean) {
    return queryOptions({
        queryKey: ["training-templates", { includeArchived }],
        queryFn: async () =>
            workoutTemplateListResponseSchema.parse(
                await apiRequest(`/training/templates${includeArchived ? "?includeArchived=true" : ""}`),
            ),
    });
}

export function workoutTemplateQueryOptions(templateId: string | null) {
    return queryOptions({
        queryKey: ["training-template", templateId],
        enabled: templateId !== null,
        queryFn: async () =>
            workoutTemplateResponseSchema.parse(
                await apiRequest(`/training/templates/${encodeURIComponent(templateId!)}`),
            ),
    });
}

export async function createWorkoutTemplate(input: unknown): Promise<WorkoutTemplateResponse> {
    return workoutTemplateResponseSchema.parse(
        await apiRequest("/training/templates", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createWorkoutTemplateRequestSchema.parse(input)),
        }),
    );
}

export async function updateWorkoutTemplate(
    template: Pick<WorkoutTemplateSummary, "id" | "version">,
    input: unknown,
): Promise<WorkoutTemplateResponse> {
    return workoutTemplateResponseSchema.parse(
        await apiRequest(`/training/templates/${encodeURIComponent(template.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(template.version, crypto.randomUUID()),
            body: JSON.stringify(updateWorkoutTemplateRequestSchema.parse(input)),
        }),
    );
}

export async function changeWorkoutTemplateStatus(
    template: Pick<WorkoutTemplateSummary, "id" | "version">,
    action: "archive" | "restore",
): Promise<WorkoutTemplateResponse> {
    return workoutTemplateResponseSchema.parse(
        await apiRequest(`/training/templates/${encodeURIComponent(template.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(template.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export function programsQueryOptions(includeArchived: boolean) {
    return queryOptions({
        queryKey: ["training-programs", { includeArchived }],
        queryFn: async () =>
            programListResponseSchema.parse(
                await apiRequest(`/training/programs${includeArchived ? "?includeArchived=true" : ""}`),
            ),
    });
}

export function programQueryOptions(programId: string | null) {
    return queryOptions({
        queryKey: ["training-program", programId],
        enabled: programId !== null,
        queryFn: async () =>
            programResponseSchema.parse(await apiRequest(`/training/programs/${encodeURIComponent(programId!)}`)),
    });
}

export function programRevisionHistoryQueryOptions(programId: string | null) {
    return queryOptions({
        queryKey: ["training", "program-history", programId],
        enabled: programId !== null,
        queryFn: async () =>
            revisionHistoryResponseSchema.parse(
                await apiRequest(`/history/training.program/${encodeURIComponent(programId!)}`),
            ),
    });
}

export async function createProgram(input: unknown): Promise<ProgramResponse> {
    return programResponseSchema.parse(
        await apiRequest("/training/programs", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createProgramRequestSchema.parse(input)),
        }),
    );
}

export async function updateProgram(
    program: Pick<ProgramSummary, "id" | "version">,
    input: unknown,
): Promise<ProgramResponse> {
    return programResponseSchema.parse(
        await apiRequest(`/training/programs/${encodeURIComponent(program.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(program.version, crypto.randomUUID()),
            body: JSON.stringify(updateProgramRequestSchema.parse(input)),
        }),
    );
}

/** Program lifecycle transitions plus archive/restore share one quoted-ETag POST shape. */
export async function changeProgramStatus(
    program: Pick<ProgramSummary, "id" | "version">,
    action: "pause" | "resume" | "complete" | "archive" | "restore",
): Promise<ProgramResponse> {
    return programResponseSchema.parse(
        await apiRequest(`/training/programs/${encodeURIComponent(program.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(program.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export function programSessionsQueryOptions(programId: string | null) {
    return queryOptions({
        queryKey: ["training-program-sessions", programId],
        enabled: programId !== null,
        queryFn: async () =>
            programSessionsResponseSchema.parse(
                await apiRequest(`/training/programs/${encodeURIComponent(programId!)}/sessions`),
            ),
    });
}

export function plannedSessionQueryOptions(sessionId: string | null) {
    return queryOptions({
        queryKey: ["training-planned-session", sessionId],
        enabled: sessionId !== null,
        queryFn: async () =>
            plannedSessionResponseSchema.parse(
                await apiRequest(`/training/planned-sessions/${encodeURIComponent(sessionId!)}`),
            ),
    });
}

/** Activate a draft program, generating its planned sessions from the supplied template plans. */
export async function activateProgram(
    program: Pick<ProgramSummary, "id" | "version">,
    input: unknown,
): Promise<ActivateProgramResponse> {
    return activateProgramResponseSchema.parse(
        await apiRequest(`/training/programs/${encodeURIComponent(program.id)}/activate`, {
            method: "POST",
            headers: mutationHeaders(program.version, crypto.randomUUID()),
            body: JSON.stringify(activateProgramRequestSchema.parse(input)),
        }),
    );
}

/** Change a program's start date, sliding only its incomplete future sessions. */
export async function changeProgramStartDate(
    program: Pick<ProgramSummary, "id" | "version">,
    input: unknown,
): Promise<ChangeProgramStartDateResponse> {
    return changeProgramStartDateResponseSchema.parse(
        await apiRequest(`/training/programs/${encodeURIComponent(program.id)}/change-start-date`, {
            method: "POST",
            headers: mutationHeaders(program.version, crypto.randomUUID()),
            body: JSON.stringify(changeProgramStartDateRequestSchema.parse(input)),
        }),
    );
}

export async function reschedulePlannedSession(
    session: Pick<PlannedSessionResponse, "id" | "version">,
    input: unknown,
): Promise<PlannedSessionResponse> {
    return plannedSessionResponseSchema.parse(
        await apiRequest(`/training/planned-sessions/${encodeURIComponent(session.id)}/reschedule`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(reschedulePlannedSessionRequestSchema.parse(input)),
        }),
    );
}

/** Skip or cancel a planned session with an optional structured reason. */
export async function changePlannedSessionOutcome(
    session: Pick<PlannedSessionResponse, "id" | "version">,
    action: "skip" | "cancel",
    input: unknown,
): Promise<PlannedSessionResponse> {
    return plannedSessionResponseSchema.parse(
        await apiRequest(`/training/planned-sessions/${encodeURIComponent(session.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(skipCancelPlannedSessionRequestSchema.parse(input)),
        }),
    );
}

export function trainingSessionsQueryOptions(includeArchived: boolean) {
    return queryOptions({
        queryKey: ["training-sessions", includeArchived],
        queryFn: async () =>
            trainingSessionListResponseSchema.parse(
                await apiRequest(`/training/sessions${includeArchived ? "?includeArchived=true" : ""}`),
            ),
    });
}

export function trainingSessionQueryOptions(sessionId: string | null) {
    return queryOptions({
        queryKey: ["training-session", sessionId],
        enabled: sessionId !== null,
        queryFn: async () =>
            trainingSessionResponseSchema.parse(
                await apiRequest(`/training/sessions/${encodeURIComponent(sessionId!)}`),
            ),
    });
}

export function trainingSessionRevisionHistoryQueryOptions(sessionId: string | null) {
    return queryOptions({
        queryKey: ["training-session-history", sessionId],
        enabled: sessionId !== null,
        queryFn: async () =>
            revisionHistoryResponseSchema.parse(
                await apiRequest(`/history/training.session/${encodeURIComponent(sessionId!)}`),
            ),
    });
}

export async function createTrainingSession(input: unknown): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest("/training/sessions", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(createTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function updateTrainingSession(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}`, {
            method: "PATCH",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(updateTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function completeTrainingSession(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown = {},
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/complete`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(completeTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function startPlannedTrainingSession(input: unknown): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest("/training/sessions/start-planned", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(startPlannedTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function recordSessionMappings(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/mappings`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(recordSessionMappingsRequestSchema.parse(input)),
        }),
    );
}

/** Lifecycle transitions that carry no body: start, reopen, archive, restore. */
export async function transitionTrainingSession(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    action: "start" | "reopen" | "archive" | "restore",
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/${action}`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: "{}",
        }),
    );
}

export function activeTrainingSessionQueryOptions(sessionId: string | null) {
    return queryOptions({
        queryKey: ["training-session-active", sessionId],
        enabled: sessionId !== null,
        queryFn: async () =>
            activeTrainingSessionResponseSchema.parse(
                await apiRequest(`/training/sessions/${encodeURIComponent(sessionId!)}/active`),
            ),
    });
}

export function completionPreviewQueryOptions(sessionId: string | null, enabled = true) {
    return queryOptions({
        queryKey: ["training-session-completion", sessionId],
        enabled: sessionId !== null && enabled,
        queryFn: async () =>
            completionPreviewResponseSchema.parse(
                await apiRequest(`/training/sessions/${encodeURIComponent(sessionId!)}/completion-preview`),
            ),
    });
}

export async function startEmptyTrainingSession(input: unknown = {}): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest("/training/sessions/start-empty", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(startEmptyTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function startTemplateTrainingSession(input: unknown): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest("/training/sessions/start-template", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(startTemplateTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function startPreviousTrainingSession(input: unknown): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest("/training/sessions/start-previous", {
            method: "POST",
            headers: mutationHeaders(undefined, crypto.randomUUID()),
            body: JSON.stringify(startPreviousTrainingSessionRequestSchema.parse(input)),
        }),
    );
}

export async function addSessionActivity(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/activities`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(addSessionActivityRequestSchema.parse(input)),
        }),
    );
}

export async function reorderSessionActivities(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/activities/reorder`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(reorderSessionActivitiesRequestSchema.parse(input)),
        }),
    );
}

export async function substituteOccurrence(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/occurrences/substitute`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(substituteOccurrenceRequestSchema.parse(input)),
        }),
    );
}

export async function recordPerformedSet(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(`/training/sessions/${encodeURIComponent(session.id)}/strength/sets`, {
            method: "POST",
            headers: mutationHeaders(session.version, crypto.randomUUID()),
            body: JSON.stringify(recordPerformedSetRequestSchema.parse(input)),
        }),
    );
}

export async function updatePerformedSet(
    session: Pick<TrainingSessionSummary, "id" | "version">,
    setId: string,
    input: unknown,
): Promise<TrainingSessionResponse> {
    return trainingSessionResponseSchema.parse(
        await apiRequest(
            `/training/sessions/${encodeURIComponent(session.id)}/strength/sets/${encodeURIComponent(setId)}`,
            {
                method: "PATCH",
                headers: mutationHeaders(session.version, crypto.randomUUID()),
                body: JSON.stringify(updatePerformedSetRequestSchema.parse(input)),
            },
        ),
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

/** An API error that preserves the HTTP status so callers can react (e.g. 409 reconciliation). */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Thrown on HTTP 409 (VERSION_CONFLICT): a stale write; the caller must reload and reconcile. */
export class VersionConflictError extends ApiError {
    constructor(message: string) {
        super(409, message);
        this.name = "VersionConflictError";
    }
}

async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${apiUrl}${path}`, init);
    const body: unknown = await response.json();
    if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        const message = parsed.success ? parsed.data.message : `Kinetix API request failed with HTTP ${response.status}`;
        if (response.status === 409) throw new VersionConflictError(message);
        throw new ApiError(response.status, message);
    }
    return body;
}
