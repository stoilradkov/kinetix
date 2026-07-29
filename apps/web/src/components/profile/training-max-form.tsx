import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trainingMaxFormSchema, type TrainingMaxFormValues } from "@/lib/training-max-form";

const typeOptions: { value: TrainingMaxFormValues["maxType"]; label: string }[] = [
    { value: "training_max", label: "Training max" },
    { value: "estimated_1rm", label: "Estimated 1RM" },
    { value: "custom", label: "Custom" },
];

const unitOptions: { value: TrainingMaxFormValues["loadUnit"]; label: string }[] = [
    { value: "kg", label: "kg" },
    { value: "lb", label: "lb" },
];

export function TrainingMaxForm({
    defaultValues,
    exerciseOptions,
    isSubmitting = false,
    lockExercise = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: TrainingMaxFormValues;
    readonly exerciseOptions: readonly { value: string; label: string }[];
    readonly isSubmitting?: boolean;
    readonly lockExercise?: boolean;
    readonly onSubmit: (values: TrainingMaxFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<TrainingMaxFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(trainingMaxFormSchema),
    });
    const maxType = useWatch({ control: form.control, name: "maxType" });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="exerciseId"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Exercise</FormLabel>
                            <Select disabled={lockExercise} onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Choose an exercise" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {exerciseOptions.map(option => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="maxType"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {typeOptions.map(option => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {maxType === "custom" ? (
                        <FormField
                            control={form.control}
                            name="customLabel"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Custom label</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Opener, 3RM…" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="loadValue"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Load</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={3}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="loadUnit"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Unit</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {unitOptions.map(option => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="effectiveFrom"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Effective from</FormLabel>
                            <FormControl>
                                <DateField
                                    onBlur={field.onBlur}
                                    onValueChange={next => {
                                        field.onChange(next);
                                        if (next === "" || next.length === 10) void form.trigger();
                                    }}
                                    value={field.value}
                                />
                            </FormControl>
                            <FormDescription>Defaults to now; the previous value is kept in history.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Optional context for this value." rows={2} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

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
