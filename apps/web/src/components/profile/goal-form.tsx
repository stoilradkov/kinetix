import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { goalFormSchema, type GoalFormValues } from "@/lib/goal-form";

const typeOptions: { value: GoalFormValues["type"]; label: string }[] = [
    { value: "strength", label: "Strength" },
    { value: "endurance", label: "Endurance" },
    { value: "body_composition", label: "Body composition" },
    { value: "skill", label: "Skill" },
    { value: "other", label: "Other" },
];

const statusOptions: { value: GoalFormValues["status"]; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "achieved", label: "Achieved" },
    { value: "abandoned", label: "Abandoned" },
];

export function GoalForm({
    defaultValues,
    isSubmitting = false,
    onSubmit,
    showStatus = false,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: GoalFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: GoalFormValues) => Promise<void> | void;
    readonly showStatus?: boolean;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<GoalFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(goalFormSchema),
    });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="type"
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
                    <FormField
                        control={form.control}
                        name="priority"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Priority</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={0}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Lower ranks higher (1–1000).</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="targetValue"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Target value</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={3}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Optional — pair with a unit.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="targetUnit"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Target unit</FormLabel>
                                <FormControl>
                                    <Input placeholder="kg, km, %…" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Start date</FormLabel>
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
                                <FormDescription>Defaults to today when blank.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="targetDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Target date</FormLabel>
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
                                <FormDescription>Optional deadline.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {showStatus ? (
                    <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {statusOptions.map(option => (
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
                ) : null}

                <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Notes</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Optional context for this goal." rows={3} {...field} />
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
