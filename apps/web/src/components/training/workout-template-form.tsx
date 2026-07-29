import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm, useWatch, type Control, type UseFormReturn } from "react-hook-form";

import type { ExerciseCatalogItemResponse } from "@kinetix/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    buildExerciseSnapshot,
    emptyRunStep,
    emptyRunningActivity,
    emptySet,
    emptyStrengthActivity,
    runStepTypes,
    setGroupModes,
    strengthSetTypes,
    workoutTemplateFormSchema,
    type WorkoutTemplateFormValues,
} from "@/lib/workout-template-form";

const activityLabels: Record<"strength" | "running", string> = { strength: "Strength", running: "Running" };
const setTypeLabels: Record<(typeof strengthSetTypes)[number], string> = {
    warm_up: "Warm-up",
    working: "Working",
    back_off: "Back-off",
    drop: "Drop",
    failure_amrap: "AMRAP",
    technique: "Technique",
};
const runStepLabels: Record<(typeof runStepTypes)[number], string> = {
    warm_up: "Warm-up",
    work: "Work",
    recovery: "Recovery",
    cool_down: "Cool-down",
    open: "Open",
};
const groupLabels: Record<(typeof setGroupModes)[number], string> = {
    none: "No grouping",
    superset: "Superset",
    circuit: "Circuit",
};

type TemplateForm = UseFormReturn<WorkoutTemplateFormValues>;
type TemplateControl = Control<WorkoutTemplateFormValues>;

export function WorkoutTemplateForm({
    defaultValues,
    exercises,
    isSubmitting = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: WorkoutTemplateFormValues;
    readonly exercises: readonly ExerciseCatalogItemResponse[];
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: WorkoutTemplateFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<WorkoutTemplateFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(workoutTemplateFormSchema),
    });
    const activities = useFieldArray({ control: form.control, name: "activities" });

    return (
        <Form {...form}>
            <form className="grid gap-6" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Upper A" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Optional context for this template." rows={2} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid gap-4">
                    <div className="flex items-center justify-between">
                        <FormLabel>Activities</FormLabel>
                        <div className="flex gap-2">
                            <Button
                                onClick={() => activities.append(emptyStrengthActivity())}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                <Plus />
                                Strength
                            </Button>
                            <Button
                                onClick={() => activities.append(emptyRunningActivity())}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                <Plus />
                                Running
                            </Button>
                        </div>
                    </div>
                    {typeof form.formState.errors.activities?.message === "string" ? (
                        <p className="text-destructive text-sm">{form.formState.errors.activities.message}</p>
                    ) : null}
                    {activities.fields.map((activityField, index) => (
                        <ActivityCard
                            form={form}
                            index={index}
                            key={activityField.id}
                            exercises={exercises}
                            onRemove={() => activities.remove(index)}
                            removable={activities.fields.length > 1}
                        />
                    ))}
                </div>

                {submitError ? (
                    <div
                        className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
                        role="alert"
                    >
                        {submitError.message}
                    </div>
                ) : null}

                <DialogFooter>
                    <Button disabled={isSubmitting} type="submit">
                        {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
                        {isSubmitting ? "Saving…" : submitLabel}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

function ActivityCard({
    form,
    index,
    exercises,
    onRemove,
    removable,
}: {
    readonly form: TemplateForm;
    readonly index: number;
    readonly exercises: readonly ExerciseCatalogItemResponse[];
    readonly onRemove: () => void;
    readonly removable: boolean;
}): React.JSX.Element {
    const type = useWatch({ control: form.control, name: `activities.${index}.type` });
    return (
        <div className="border-border grid gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Badge variant={type === "strength" ? "secondary" : "info"}>{activityLabels[type]}</Badge>
                    <span className="text-muted-foreground text-sm">Activity {index + 1}</span>
                </div>
                <Button
                    aria-label="Remove activity"
                    disabled={!removable}
                    onClick={onRemove}
                    size="icon"
                    type="button"
                    variant="ghost"
                >
                    <Trash2 />
                </Button>
            </div>

            {type === "strength" ? (
                <StrengthActivity control={form.control} form={form} index={index} exercises={exercises} />
            ) : (
                <RunningActivity control={form.control} form={form} index={index} />
            )}

            <FormField
                control={form.control}
                name={`activities.${index}.notes`}
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <Textarea placeholder="Activity notes (optional)" rows={1} {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}

function StrengthActivity({
    control,
    form,
    index,
    exercises,
}: {
    readonly control: TemplateControl;
    readonly form: TemplateForm;
    readonly index: number;
    readonly exercises: readonly ExerciseCatalogItemResponse[];
}): React.JSX.Element {
    const exerciseArray = useFieldArray({ control, name: `activities.${index}.exercises` });
    const groupMode = useWatch({ control, name: `activities.${index}.groupMode` });
    return (
        <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                    control={control}
                    name={`activities.${index}.groupMode`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Grouping</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {setGroupModes.map(mode => (
                                        <SelectItem key={mode} value={mode}>
                                            {groupLabels[mode]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {groupMode !== "none" ? (
                    <FormField
                        control={control}
                        name={`activities.${index}.groupRounds`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Rounds</FormLabel>
                                <FormControl>
                                    <Input className="font-mono tabular-nums" inputMode="numeric" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : null}
            </div>

            <div className="flex items-center justify-between">
                <FormLabel>Exercises</FormLabel>
                <Button
                    onClick={() =>
                        exerciseArray.append({
                            exerciseId: "",
                            name: "",
                            snapshot: undefined as never,
                            sets: [emptySet()],
                        })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    <Plus />
                    Add exercise
                </Button>
            </div>
            {typeof form.formState.errors.activities?.[index]?.exercises?.message === "string" ? (
                <p className="text-destructive text-sm">
                    {form.formState.errors.activities[index]?.exercises?.message}
                </p>
            ) : null}
            {exerciseArray.fields.map((exerciseField, exerciseIndex) => (
                <ExerciseRow
                    control={control}
                    form={form}
                    activityIndex={index}
                    exerciseIndex={exerciseIndex}
                    exercises={exercises}
                    key={exerciseField.id}
                    onRemove={() => exerciseArray.remove(exerciseIndex)}
                />
            ))}
        </div>
    );
}

function ExerciseRow({
    control,
    form,
    activityIndex,
    exerciseIndex,
    exercises,
    onRemove,
}: {
    readonly control: TemplateControl;
    readonly form: TemplateForm;
    readonly activityIndex: number;
    readonly exerciseIndex: number;
    readonly exercises: readonly ExerciseCatalogItemResponse[];
    readonly onRemove: () => void;
}): React.JSX.Element {
    const sets = useFieldArray({ control, name: `activities.${activityIndex}.exercises.${exerciseIndex}.sets` });
    return (
        <div className="bg-muted/40 grid gap-3 rounded-md p-3">
            <div className="flex items-end gap-2">
                <FormField
                    control={control}
                    name={`activities.${activityIndex}.exercises.${exerciseIndex}.exerciseId`}
                    render={({ field }) => (
                        <FormItem className="flex-1">
                            <FormLabel>Exercise</FormLabel>
                            <Select
                                onValueChange={value => {
                                    const item = exercises.find(candidate => candidate.id === value);
                                    field.onChange(value);
                                    if (item) {
                                        form.setValue(
                                            `activities.${activityIndex}.exercises.${exerciseIndex}.name`,
                                            item.name,
                                        );
                                        form.setValue(
                                            `activities.${activityIndex}.exercises.${exerciseIndex}.snapshot`,
                                            buildExerciseSnapshot(item),
                                        );
                                    }
                                }}
                                value={field.value}
                            >
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select an exercise" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {exercises.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button aria-label="Remove exercise" onClick={onRemove} size="icon" type="button" variant="ghost">
                    <Trash2 />
                </Button>
            </div>

            <div className="grid gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs uppercase">Sets</span>
                    <Button onClick={() => sets.append(emptySet())} size="sm" type="button" variant="ghost">
                        <Plus />
                        Add set
                    </Button>
                </div>
                {sets.fields.length > 0 ? (
                    <ColumnHeader
                        grid={SET_GRID}
                        labels={["Type", "Reps min", "Reps max", "Load kg", "% 1RM", "Rest s"]}
                    />
                ) : null}
                {sets.fields.map((setField, setIndex) => (
                    <SetRow
                        control={control}
                        form={form}
                        activityIndex={activityIndex}
                        exerciseIndex={exerciseIndex}
                        key={setField.id}
                        onRemove={() => sets.remove(setIndex)}
                        removable={sets.fields.length > 1}
                        setIndex={setIndex}
                    />
                ))}
            </div>
        </div>
    );
}

function SetRow({
    control,
    form,
    activityIndex,
    exerciseIndex,
    setIndex,
    onRemove,
    removable,
}: {
    readonly control: TemplateControl;
    readonly form: TemplateForm;
    readonly activityIndex: number;
    readonly exerciseIndex: number;
    readonly setIndex: number;
    readonly onRemove: () => void;
    readonly removable: boolean;
}): React.JSX.Element {
    const base = `activities.${activityIndex}.exercises.${exerciseIndex}.sets.${setIndex}` as const;
    // Re-validate coupled fields so clearing one half of a cross-field rule clears its error.
    const revalidateReps = () => void form.trigger([`${base}.repsMin`, `${base}.repsMax`]);
    const revalidateLoad = () => void form.trigger([`${base}.loadKg`, `${base}.percent1rm`]);
    return (
        <div className={`${SET_GRID} items-start`}>
            <FormField
                control={control}
                name={`${base}.setType`}
                render={({ field }) => (
                    <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {strengthSetTypes.map(value => (
                                    <SelectItem key={value} value={value}>
                                        {setTypeLabels[value]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormItem>
                )}
            />
            <NumberCell control={control} label="Reps min" name={`${base}.repsMin`} onCommit={revalidateReps} />
            <NumberCell control={control} label="Reps max" name={`${base}.repsMax`} onCommit={revalidateReps} />
            <NumberCell control={control} label="Load kg" name={`${base}.loadKg`} onCommit={revalidateLoad} />
            <NumberCell control={control} label="% 1RM" name={`${base}.percent1rm`} onCommit={revalidateLoad} />
            <NumberCell control={control} label="Rest s" name={`${base}.restSec`} />
            <Button
                aria-label="Remove set"
                className="justify-self-center"
                disabled={!removable}
                onClick={onRemove}
                size="icon"
                type="button"
                variant="ghost"
            >
                <Trash2 />
            </Button>
        </div>
    );
}

function RunningActivity({
    control,
    form,
    index,
}: {
    readonly control: TemplateControl;
    readonly form: TemplateForm;
    readonly index: number;
}): React.JSX.Element {
    const steps = useFieldArray({ control, name: `activities.${index}.steps` });
    return (
        <div className="grid gap-4">
            <FormField
                control={control}
                name={`activities.${index}.runTags`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Run tags</FormLabel>
                        <FormControl>
                            <Input placeholder="Comma-separated, e.g. intervals, tempo" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="flex items-center justify-between">
                <FormLabel>Run steps</FormLabel>
                <Button onClick={() => steps.append(emptyRunStep())} size="sm" type="button" variant="outline">
                    <Plus />
                    Add step
                </Button>
            </div>
            {typeof form.formState.errors.activities?.[index]?.steps?.message === "string" ? (
                <p className="text-destructive text-sm">{form.formState.errors.activities[index]?.steps?.message}</p>
            ) : null}
            {steps.fields.length > 0 ? (
                <ColumnHeader grid={STEP_GRID} labels={["Type", "Distance m", "Duration s"]} />
            ) : null}
            {steps.fields.map((stepField, stepIndex) => {
                const base = `activities.${index}.steps.${stepIndex}` as const;
                const revalidateStep = () => void form.trigger([`${base}.distanceM`, `${base}.durationSec`]);
                return (
                    <div className={`${STEP_GRID} items-start`} key={stepField.id}>
                        <FormField
                            control={control}
                            name={`${base}.type`}
                            render={({ field }) => (
                                <FormItem>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {runStepTypes.map(value => (
                                                <SelectItem key={value} value={value}>
                                                    {runStepLabels[value]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                        <NumberCell
                            control={control}
                            label="Distance m"
                            name={`${base}.distanceM`}
                            onCommit={revalidateStep}
                        />
                        <NumberCell
                            control={control}
                            label="Duration s"
                            name={`${base}.durationSec`}
                            onCommit={revalidateStep}
                        />
                        <Button
                            aria-label="Remove step"
                            className="justify-self-center"
                            disabled={steps.fields.length <= 1}
                            onClick={() => steps.remove(stepIndex)}
                            size="icon"
                            type="button"
                            variant="ghost"
                        >
                            <Trash2 />
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}

function NumberCell({
    control,
    label,
    name,
    onCommit,
}: {
    readonly control: TemplateControl;
    readonly label: string;
    readonly name: string;
    /** Runs after the value changes — used to re-validate a coupled sibling field. */
    readonly onCommit?: () => void;
}): React.JSX.Element {
    return (
        <FormField
            control={control}
            name={name as never}
            render={({ field }) => (
                <FormItem>
                    <FormControl>
                        <Input
                            aria-label={label}
                            className="font-mono tabular-nums"
                            inputMode="decimal"
                            placeholder="—"
                            {...field}
                            onChange={event => {
                                field.onChange(event);
                                onCommit?.();
                            }}
                            value={typeof field.value === "string" ? field.value : ""}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

const SET_GRID = "grid grid-cols-[minmax(7rem,1fr)_repeat(5,minmax(3.5rem,1fr))_2.25rem] gap-2";
const STEP_GRID = "grid grid-cols-[minmax(7rem,1fr)_repeat(2,minmax(4rem,1fr))_2.25rem] gap-2";

function ColumnHeader({
    grid,
    labels,
}: {
    readonly grid: string;
    readonly labels: readonly string[];
}): React.JSX.Element {
    return (
        <div className={grid}>
            {labels.map(label => (
                <span className="text-muted-foreground text-xs" key={label}>
                    {label}
                </span>
            ))}
            <span />
        </div>
    );
}
