import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MultiSelectField, type MultiSelectOption } from "@/components/ui/multi-select-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { injuryFormSchema, SIDE_UNSPECIFIED, type InjuryFormValues } from "@/lib/injury-form";

const sideOptions: { value: InjuryFormValues["side"]; label: string }[] = [
    { value: SIDE_UNSPECIFIED, label: "Unspecified" },
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "bilateral", label: "Bilateral" },
];

const severityOptions: { value: InjuryFormValues["severity"]; label: string }[] = [
    { value: "mild", label: "Mild" },
    { value: "moderate", label: "Moderate" },
    { value: "severe", label: "Severe" },
];

const statusOptions: { value: InjuryFormValues["status"]; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "recovering", label: "Recovering" },
    { value: "resolved", label: "Resolved" },
];

export function InjuryForm({
    defaultValues,
    exerciseOptions,
    isSubmitting = false,
    muscleOptions,
    onSubmit,
    showStatus = false,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: InjuryFormValues;
    readonly exerciseOptions: readonly MultiSelectOption[];
    readonly isSubmitting?: boolean;
    readonly muscleOptions: readonly MultiSelectOption[];
    readonly onSubmit: (values: InjuryFormValues) => Promise<void> | void;
    readonly showStatus?: boolean;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<InjuryFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(injuryFormSchema),
    });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Left shoulder strain" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="bodyArea"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Body area</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. shoulder" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="side"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Side</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {sideOptions.map(option => (
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
                        name="severity"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Severity</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {severityOptions.map(option => (
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

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="onsetDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Onset date</FormLabel>
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
                        name="resolvedDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Resolved date</FormLabel>
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
                                <FormDescription>Set only when resolved.</FormDescription>
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
                                <Select
                                    onValueChange={next => {
                                        field.onChange(next);
                                        void form.trigger("resolvedDate");
                                    }}
                                    value={field.value}
                                >
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
                    name="muscleGroupIds"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Affected muscle groups</FormLabel>
                            <FormControl>
                                <MultiSelectField
                                    emptyText="No muscle groups found."
                                    onValueChange={field.onChange}
                                    options={muscleOptions}
                                    placeholder="Link muscle groups"
                                    searchPlaceholder="Search muscle groups…"
                                    value={field.value}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="exerciseIds"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Affected exercises</FormLabel>
                            <FormControl>
                                <MultiSelectField
                                    emptyText="No exercises found."
                                    onValueChange={field.onChange}
                                    options={exerciseOptions}
                                    placeholder="Link exercises"
                                    searchPlaceholder="Search exercises…"
                                    value={field.value}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Notes</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Optional context for this injury." rows={3} {...field} />
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
