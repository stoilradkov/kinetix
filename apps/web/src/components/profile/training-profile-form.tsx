import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trainingProfileFormSchema, type TrainingProfileFormValues } from "@/lib/training-profile-form";

const experienceOptions: { value: TrainingProfileFormValues["experience"]; label: string }[] = [
    { value: "beginner", label: "Beginner" },
    { value: "intermediate", label: "Intermediate" },
    { value: "advanced", label: "Advanced" },
];

export function TrainingProfileForm({
    defaultValues,
    isSubmitting = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: TrainingProfileFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: TrainingProfileFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<TrainingProfileFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(trainingProfileFormSchema),
    });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="experience"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Experience</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {experienceOptions.map(option => (
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

                <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                        control={form.control}
                        name="oneRepMaxRepCutoff"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>1RM rep cutoff</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={0}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        suffix="reps"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Sets at or below this count feed 1RM.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="hardSetRpeThreshold"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Hard-set RPE</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={1}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        suffix="RPE"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>At or above counts as hard.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="hardSetRirThreshold"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Hard-set RIR</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={0}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        suffix="RIR"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>At or below counts as hard.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
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
