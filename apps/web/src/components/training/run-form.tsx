import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Plus, X } from "lucide-react";
import { useForm, useFieldArray, type Control } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DecimalField } from "@/components/ui/decimal-field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeZoneField } from "@/components/ui/time-zone-field";
import { gearItemsQueryOptions } from "@/lib/api";
import {
    distanceUnits,
    durationUnits,
    mappingRelations,
    painSides,
    runFormSchema,
    runStepTypes,
    type RunFormValues,
} from "@/lib/run-form";

const runStepLabels: Record<(typeof runStepTypes)[number], string> = {
    warm_up: "Warm-up",
    work: "Work",
    recovery: "Recovery",
    repeat: "Repeat",
    cool_down: "Cool-down",
    open: "Open",
};

/**
 * Create/edit form for a manual or mixed-session run (PRD R3, AC-3). It captures the summary,
 * intervals (steps), arbitrary splits, environment, gear, notes, run tags, pain, and — in edit mode —
 * plan mappings. On create it logs and completes a run in one call; on edit it corrects the run's
 * running detail and mappings. Uses design-system primitives and the shared measurement fields.
 */
export function RunForm({
    mode,
    defaultValues,
    isSubmitting,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly mode: "create" | "edit";
    readonly defaultValues: RunFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: RunFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<RunFormValues>({ defaultValues, mode: "onTouched", resolver: zodResolver(runFormSchema) });
    const submitting = isSubmitting ?? form.formState.isSubmitting;
    const gear = useQuery(gearItemsQueryOptions(false));
    const steps = useFieldArray({ control: form.control, name: "steps" });
    const splits = useFieldArray({ control: form.control, name: "splits" });
    const pain = useFieldArray({ control: form.control, name: "pain" });
    const mappings = useFieldArray({ control: form.control, name: "mappings" });

    return (
        <Form {...form}>
            <form className="grid gap-6" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                {mode === "create" ? (
                    <section className="grid gap-4">
                        <FormField
                            control={form.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Title (optional)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Tempo run" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <FormField
                                control={form.control}
                                name="localDate"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Date</FormLabel>
                                        <FormControl>
                                            <DateField onValueChange={field.onChange} value={field.value} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="timeZone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Time zone</FormLabel>
                                        <FormControl>
                                            <TimeZoneField onValueChange={field.onChange} value={field.value} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </section>
                ) : null}

                <section className="grid gap-4">
                    <h3 className="text-sm font-medium">Summary</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <MeasureField control={form.control} label="Distance" name="distance" units={distanceUnits} />
                        <MeasureField
                            control={form.control}
                            label="Moving time"
                            name="movingTime"
                            units={durationUnits}
                        />
                        <MeasureField
                            control={form.control}
                            label="Elapsed time"
                            name="elapsedTime"
                            units={durationUnits}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <FormField
                            control={form.control}
                            name="averageHeartRate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Avg HR</FormLabel>
                                    <FormControl>
                                        <Input inputMode="numeric" placeholder="bpm" {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="rpe"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>RPE (1–10)</FormLabel>
                                    <FormControl>
                                        <DecimalField
                                            maxDecimals={1}
                                            onValueChange={field.onChange}
                                            value={field.value}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <div className="flex items-end gap-2">
                            <ToggleField control={form.control} label="Indoor" name="indoor" />
                            <ToggleField control={form.control} label="Treadmill" name="treadmill" />
                        </div>
                    </div>
                    <FormField
                        control={form.control}
                        name="runTags"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Run tags</FormLabel>
                                <FormControl>
                                    <TagsInput onValueChange={field.onChange} value={field.value} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </section>

                <ArraySection
                    addLabel="Add interval"
                    onAdd={() =>
                        steps.append({
                            id: crypto.randomUUID(),
                            type: "work",
                            distanceValue: "",
                            distanceUnit: "km",
                            durationValue: "",
                            durationUnit: "min",
                        })
                    }
                    title="Intervals"
                >
                    {steps.fields.map((row, index) => (
                        <div className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-4" key={row.id}>
                            <FormField
                                control={form.control}
                                name={`steps.${index}.type`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs">Type</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {runStepTypes.map(type => (
                                                    <SelectItem key={type} value={type}>
                                                        {runStepLabels[type]}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                            <MeasureField
                                control={form.control}
                                compact
                                label="Distance"
                                name={`steps.${index}.distance` as "distance"}
                                units={distanceUnits}
                                valueName={`steps.${index}.distanceValue`}
                                unitName={`steps.${index}.distanceUnit`}
                            />
                            <MeasureField
                                control={form.control}
                                compact
                                label="Duration"
                                name={`steps.${index}.duration` as "distance"}
                                units={durationUnits}
                                valueName={`steps.${index}.durationValue`}
                                unitName={`steps.${index}.durationUnit`}
                            />
                            <RemoveButton onClick={() => steps.remove(index)} />
                        </div>
                    ))}
                </ArraySection>

                <ArraySection
                    addLabel="Add split"
                    onAdd={() =>
                        splits.append({
                            id: crypto.randomUUID(),
                            distanceValue: "",
                            distanceUnit: "km",
                            movingValue: "",
                            movingUnit: "min",
                        })
                    }
                    title="Splits"
                >
                    {splits.fields.map((row, index) => (
                        <div className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-3" key={row.id}>
                            <MeasureField
                                control={form.control}
                                compact
                                label="Distance"
                                name={`splits.${index}.distance` as "distance"}
                                units={distanceUnits}
                                valueName={`splits.${index}.distanceValue`}
                                unitName={`splits.${index}.distanceUnit`}
                            />
                            <MeasureField
                                control={form.control}
                                compact
                                label="Moving time"
                                name={`splits.${index}.moving` as "distance"}
                                units={durationUnits}
                                valueName={`splits.${index}.movingValue`}
                                unitName={`splits.${index}.movingUnit`}
                            />
                            <RemoveButton onClick={() => splits.remove(index)} />
                        </div>
                    ))}
                </ArraySection>

                <section className="grid gap-3">
                    <h3 className="text-sm font-medium">Environment &amp; gear</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <FormField
                            control={form.control}
                            name="environmentSurface"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Surface</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. road" {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="environmentWeather"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Weather</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. clear" {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="environmentTemperature"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Temp (°C)</FormLabel>
                                    <FormControl>
                                        <Input inputMode="numeric" placeholder="°C" {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="gearItemId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Gear</FormLabel>
                                <Select
                                    onValueChange={value => field.onChange(value === "none" ? "" : value)}
                                    value={field.value === "" ? "none" : field.value}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="none">—</SelectItem>
                                        {(gear.data?.items ?? []).map(item => (
                                            <SelectItem key={item.id} value={item.id}>
                                                {item.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}
                    />
                </section>

                {mode === "create" ? (
                    <>
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Notes</FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="How did it go?" rows={3} {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <ArraySection
                            addLabel="Add pain record"
                            onAdd={() =>
                                pain.append({ id: crypto.randomUUID(), bodyArea: "", side: "left", severity: "0" })
                            }
                            title="Pain"
                        >
                            {pain.fields.map((row, index) => (
                                <div
                                    className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-4"
                                    key={row.id}
                                >
                                    <FormField
                                        control={form.control}
                                        name={`pain.${index}.bodyArea`}
                                        render={({ field }) => (
                                            <FormItem className="sm:col-span-2">
                                                <FormLabel className="text-xs">Body area</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Knee" {...field} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name={`pain.${index}.side`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs">Side</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {painSides.map(side => (
                                                            <SelectItem key={side} value={side}>
                                                                {side}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                    <div className="flex items-end gap-2">
                                        <FormField
                                            control={form.control}
                                            name={`pain.${index}.severity`}
                                            render={({ field }) => (
                                                <FormItem className="flex-1">
                                                    <FormLabel className="text-xs">Severity</FormLabel>
                                                    <FormControl>
                                                        <Input inputMode="numeric" {...field} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <RemoveButton onClick={() => pain.remove(index)} />
                                    </div>
                                </div>
                            ))}
                        </ArraySection>
                    </>
                ) : (
                    <ArraySection
                        addLabel="Add plan mapping"
                        description="Link a performed step to a prescribed run step from the linked plan."
                        onAdd={() =>
                            mappings.append({
                                id: crypto.randomUUID(),
                                performedRunStepId: form.getValues("steps")[0]?.id ?? "",
                                prescribedRunStepId: "",
                                relation: "matched",
                            })
                        }
                        title="Plan mappings"
                    >
                        {mappings.fields.map((row, index) => (
                            <div className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-4" key={row.id}>
                                <FormField
                                    control={form.control}
                                    name={`mappings.${index}.performedRunStepId`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs">Performed step</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Step" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {form.getValues("steps").map((step, stepIndex) => (
                                                        <SelectItem key={step.id} value={step.id}>
                                                            #{stepIndex + 1} {runStepLabels[step.type]}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name={`mappings.${index}.relation`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs">Relation</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {mappingRelations.map(relation => (
                                                        <SelectItem key={relation} value={relation}>
                                                            {relation}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name={`mappings.${index}.prescribedRunStepId`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs">Prescribed step ID</FormLabel>
                                            <FormControl>
                                                <Input className="font-mono" placeholder="UUID" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <RemoveButton onClick={() => mappings.remove(index)} />
                            </div>
                        ))}
                    </ArraySection>
                )}

                {submitError ? (
                    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
                        {submitError.message}
                    </div>
                ) : null}

                <Button disabled={submitting} type="submit">
                    {submitting ? <LoaderCircle className="animate-spin" /> : null}
                    {submitLabel}
                </Button>
            </form>
        </Form>
    );
}

/** A measurement input: a decimal value plus a unit dropdown, both bound to the form. */
function MeasureField({
    control,
    label,
    name,
    units,
    valueName,
    unitName,
    compact,
}: {
    readonly control: Control<RunFormValues>;
    readonly label: string;
    readonly name: string;
    readonly units: readonly string[];
    readonly valueName?: string;
    readonly unitName?: string;
    readonly compact?: boolean;
}): React.JSX.Element {
    const value = (valueName ?? `${name}.value`) as "averageHeartRate";
    const unit = (unitName ?? `${name}.unit`) as "averageHeartRate";
    return (
        <FormItem>
            <FormLabel className={compact ? "text-xs" : undefined}>{label}</FormLabel>
            <div className="flex gap-2">
                <FormField
                    control={control}
                    name={value}
                    render={({ field }) => (
                        <FormControl>
                            <DecimalField onValueChange={field.onChange} value={field.value} />
                        </FormControl>
                    )}
                />
                <FormField
                    control={control}
                    name={unit}
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                                <SelectTrigger className="w-20">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {units.map(option => (
                                    <SelectItem key={option} value={option}>
                                        {option}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </div>
        </FormItem>
    );
}

function ToggleField({
    control,
    label,
    name,
}: {
    readonly control: Control<RunFormValues>;
    readonly label: string;
    readonly name: "indoor" | "treadmill";
}): React.JSX.Element {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <Button
                    onClick={() => field.onChange(!field.value)}
                    size="sm"
                    type="button"
                    variant={field.value ? "default" : "outline"}
                >
                    {label}
                </Button>
            )}
        />
    );
}

function ArraySection({
    title,
    description,
    addLabel,
    onAdd,
    children,
}: {
    readonly title: string;
    readonly description?: string;
    readonly addLabel: string;
    readonly onAdd: () => void;
    readonly children: React.ReactNode;
}): React.JSX.Element {
    return (
        <section className="grid gap-2">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{title}</h3>
                <Button onClick={onAdd} size="sm" type="button" variant="outline">
                    <Plus />
                    {addLabel}
                </Button>
            </div>
            {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
            {children}
        </section>
    );
}

function RemoveButton({ onClick }: { readonly onClick: () => void }): React.JSX.Element {
    return (
        <Button className="self-end" onClick={onClick} size="sm" type="button" variant="ghost">
            <X />
            Remove
        </Button>
    );
}

/** Free-form tag chips: add on Enter/comma, remove via the chip button. */
function TagsInput({
    value,
    onValueChange,
}: {
    readonly value: readonly string[];
    readonly onValueChange: (value: string[]) => void;
}): React.JSX.Element {
    return (
        <div className="grid gap-2">
            {value.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {value.map(tag => (
                        <Badge className="gap-1" key={tag} variant="secondary">
                            {tag}
                            <button
                                aria-label={`Remove ${tag}`}
                                className="cursor-pointer"
                                onClick={() => onValueChange(value.filter(item => item !== tag))}
                                type="button"
                            >
                                <X className="size-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            ) : null}
            <Input
                onKeyDown={event => {
                    if (event.key !== "Enter" && event.key !== ",") return;
                    event.preventDefault();
                    const tag = event.currentTarget.value.trim();
                    if (tag.length > 0 && !value.some(item => item.toLocaleLowerCase() === tag.toLocaleLowerCase()))
                        onValueChange([...value, tag]);
                    event.currentTarget.value = "";
                }}
                placeholder="Add a tag and press Enter"
            />
        </div>
    );
}
