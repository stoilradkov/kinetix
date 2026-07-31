import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { emptyProgramBlock, programFormSchema, type ProgramFormValues } from "@/lib/program-form";

const scheduleModeLabels: Record<ProgramFormValues["scheduleMode"], string> = {
    ordered: "Ordered (no dates)",
    relative: "Relative (week/day)",
    dated: "Dated (calendar)",
};

const blockTypeLabels: Record<ProgramFormValues["blocks"][number]["type"], string> = {
    macrocycle: "Macrocycle",
    mesocycle: "Mesocycle",
    microcycle: "Microcycle / week",
    custom: "Custom",
};

export function ProgramForm({
    defaultValues,
    isSubmitting,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: ProgramFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: ProgramFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<ProgramFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(programFormSchema),
    });
    const blocks = useFieldArray({ control: form.control, name: "blocks" });
    const submitting = isSubmitting ?? form.formState.isSubmitting;

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
                                <Input placeholder="e.g. Off-season strength" {...field} />
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
                                <Textarea placeholder="What this program is for" rows={2} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="scheduleMode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Schedule mode</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {Object.entries(scheduleModeLabels).map(([value, label]) => (
                                            <SelectItem key={value} value={value}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="focus"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Focus (optional)</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Hypertrophy" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Start date (optional)</FormLabel>
                                <FormControl>
                                    <DateField onValueChange={field.onChange} value={field.value} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>End date (optional)</FormLabel>
                                <FormControl>
                                    <DateField onValueChange={field.onChange} value={field.value} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid gap-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Blocks</h3>
                        <Button
                            onClick={() => blocks.append(emptyProgramBlock(crypto.randomUUID()))}
                            size="sm"
                            type="button"
                            variant="outline"
                        >
                            <Plus />
                            Add block
                        </Button>
                    </div>
                    {blocks.fields.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            No blocks yet. Add macrocycles, mesocycles, or microcycles to structure the program.
                        </p>
                    ) : (
                        blocks.fields.map((block, index) => (
                            <BlockRow
                                control={form.control}
                                index={index}
                                key={block.id}
                                onRemove={() => blocks.remove(index)}
                                siblings={blocks.fields.map((entry, entryIndex) => ({
                                    id: entry.id,
                                    blockId: form.getValues(`blocks.${entryIndex}.id`),
                                    label:
                                        form.getValues(`blocks.${entryIndex}.label`) ||
                                        blockTypeLabels[form.getValues(`blocks.${entryIndex}.type`)],
                                }))}
                                selfIndex={index}
                            />
                        ))
                    )}
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
                    <Button disabled={submitting} type="submit">
                        {submitting ? <LoaderCircle className="animate-spin" /> : null}
                        {submitting ? "Saving…" : submitLabel}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

function BlockRow({
    control,
    index,
    onRemove,
    siblings,
    selfIndex,
}: {
    readonly control: Control<ProgramFormValues>;
    readonly index: number;
    readonly onRemove: () => void;
    readonly siblings: readonly { id: string; blockId: string; label: string }[];
    readonly selfIndex: number;
}): React.JSX.Element {
    const type = useWatch({ control, name: `blocks.${index}.type` });
    const parents = siblings.filter((_, entryIndex) => entryIndex !== selfIndex);

    return (
        <div className="border-border grid gap-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <FormField
                        control={control}
                        name={`blocks.${index}.type`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {Object.entries(blockTypeLabels).map(([value, label]) => (
                                            <SelectItem key={value} value={value}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`blocks.${index}.label`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Label{type === "custom" ? "" : " (optional)"}</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Week 1" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`blocks.${index}.position`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Position</FormLabel>
                                <FormControl>
                                    <Input className="font-mono tabular-nums" inputMode="numeric" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`blocks.${index}.parentBlockId`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Parent (optional)</FormLabel>
                                <Select
                                    onValueChange={value => field.onChange(value === "__root__" ? "" : value)}
                                    value={field.value === "" ? "__root__" : field.value}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="__root__">No parent (top level)</SelectItem>
                                        {parents.map(parent => (
                                            <SelectItem key={parent.id} value={parent.blockId}>
                                                {parent.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`blocks.${index}.deload`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Deload</FormLabel>
                                <Select
                                    onValueChange={value => field.onChange(value === "yes")}
                                    value={field.value ? "yes" : "no"}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="no">No</SelectItem>
                                        <SelectItem value="yes">Yes — deload block</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`blocks.${index}.focus`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Focus (optional)</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Volume" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <Button aria-label="Remove block" onClick={onRemove} size="icon" type="button" variant="ghost">
                    <Trash2 />
                </Button>
            </div>
            <FormField
                control={control}
                name={`blocks.${index}.notes`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Notes (optional)</FormLabel>
                        <FormControl>
                            <Textarea rows={2} {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}
