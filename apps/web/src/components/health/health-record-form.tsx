import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import type { HealthRecordTypeValue } from "@kinetix/types";

import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeZoneField } from "@/components/ui/time-zone-field";
import { healthRecordFormSchema, type HealthRecordFormValues } from "@/lib/health-record-form";

const typeOptions: { value: HealthRecordTypeValue; label: string }[] = [
    { value: "body_weight", label: "Body weight" },
    { value: "sleep", label: "Sleep" },
    { value: "resting_heart_rate", label: "Resting heart rate" },
    { value: "daily_readiness", label: "Daily readiness" },
];

export function HealthRecordForm({
    defaultValues,
    isSubmitting = false,
    lockedType = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: HealthRecordFormValues;
    readonly isSubmitting?: boolean;
    readonly lockedType?: boolean;
    readonly onSubmit: (values: HealthRecordFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<HealthRecordFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(healthRecordFormSchema),
    });
    const type = useWatch({ control: form.control, name: "type" });

    return (
        <Form {...form}>
            <form className="grid gap-5 p-6" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                {lockedType ? null : (
                    <FormField
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Record type</FormLabel>
                                <Select
                                    onValueChange={next => {
                                        field.onChange(next);
                                        void form.trigger();
                                    }}
                                    value={field.value}
                                >
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
                )}

                {type === "sleep" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="sleepStart"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Sleep start</FormLabel>
                                    <FormControl>
                                        <DateTimeField
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
                            name="sleepEnd"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Sleep end</FormLabel>
                                    <FormControl>
                                        <DateTimeField
                                            onBlur={field.onBlur}
                                            onValueChange={field.onChange}
                                            value={field.value}
                                        />
                                    </FormControl>
                                    <FormDescription>Used as the record time.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                ) : (
                    <FormField
                        control={form.control}
                        name="effectiveAt"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Measured at</FormLabel>
                                <FormControl>
                                    <DateTimeField
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                {type === "body_weight" ? (
                    <FormField
                        control={form.control}
                        name="massKg"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Body weight</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={3}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        placeholder="82.5"
                                        suffix="kg"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : null}

                {type === "resting_heart_rate" ? (
                    <FormField
                        control={form.control}
                        name="beatsPerMinute"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Resting heart rate</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={0}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        placeholder="52"
                                        suffix="bpm"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : null}

                {type === "daily_readiness" ? (
                    <FormField
                        control={form.control}
                        name="score"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Readiness score</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={0}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        placeholder="74"
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>On a 0–100 scale.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : null}

                <FormField
                    control={form.control}
                    name="timeZone"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Time zone</FormLabel>
                            <FormControl>
                                <TimeZoneField onValueChange={field.onChange} value={field.value} />
                            </FormControl>
                            <FormDescription>Optional — the zone this reading was taken in.</FormDescription>
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
                                <Textarea placeholder="Optional context for this reading." rows={3} {...field} />
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
