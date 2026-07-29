import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { configKeysByMethod, methodsByFamily, zoneFormSchema, type ZoneFormValues } from "@/lib/zone-form";

const familyLabels: Record<ZoneFormValues["family"], string> = {
    heart_rate: "Heart rate",
    pace: "Pace",
    power: "Power",
};
const methodLabels: Record<ZoneFormValues["method"], string> = {
    percent_max_hr: "% max HR",
    percent_hr_reserve: "% HR reserve",
    lactate_threshold: "Lactate threshold",
    percent_threshold_pace: "% threshold pace",
    percent_ftp: "% FTP",
    manual: "Manual boundaries",
};
const configLabels: Record<string, string> = {
    maxHr: "Max HR (bpm)",
    restingHr: "Resting HR (bpm)",
    thresholdHr: "Threshold HR (bpm)",
    thresholdPaceMps: "Threshold pace (m/s)",
    ftpW: "FTP (W)",
};

export function ZoneForm({
    defaultValues,
    isSubmitting = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: ZoneFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: ZoneFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<ZoneFormValues>({ defaultValues, mode: "onTouched", resolver: zodResolver(zoneFormSchema) });
    const family = useWatch({ control: form.control, name: "family" });
    const method = useWatch({ control: form.control, name: "method" });
    const ranges = useFieldArray({ control: form.control, name: "ranges" });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="family"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Family</FormLabel>
                                <Select
                                    onValueChange={value => {
                                        field.onChange(value);
                                        form.setValue("method", "manual");
                                    }}
                                    value={field.value}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {(Object.keys(familyLabels) as ZoneFormValues["family"][]).map(value => (
                                            <SelectItem key={value} value={value}>
                                                {familyLabels[value]}
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
                        name="method"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Method</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {methodsByFamily[family].map(value => (
                                            <SelectItem key={value} value={value}>
                                                {methodLabels[value]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {configKeysByMethod[method].length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                        {configKeysByMethod[method].map(key => (
                            <FormField
                                control={form.control}
                                key={key}
                                name={`config.${key}` as const}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{configLabels[key] ?? key}</FormLabel>
                                        <FormControl>
                                            <DecimalField
                                                maxDecimals={4}
                                                onBlur={field.onBlur}
                                                onValueChange={field.onChange}
                                                value={field.value ?? ""}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        ))}
                    </div>
                ) : null}

                <div className="grid gap-3">
                    <div className="flex items-center justify-between">
                        <FormLabel>Ranges</FormLabel>
                        <Button
                            onClick={() =>
                                ranges.append({
                                    name: `Zone ${ranges.fields.length + 1}`,
                                    lowerBound: "",
                                    upperBound: "",
                                })
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                        >
                            <Plus />
                            Add range
                        </Button>
                    </div>
                    <FormDescription>
                        Ordered, non-overlapping. Leave the top range&rsquo;s upper bound blank.
                    </FormDescription>
                    {ranges.fields.map((rangeField, index) => (
                        <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2" key={rangeField.id}>
                            <FormField
                                control={form.control}
                                name={`ranges.${index}.name` as const}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input placeholder="Name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name={`ranges.${index}.lowerBound` as const}
                                render={({ field }) => (
                                    <FormItem className="w-24">
                                        <FormControl>
                                            <DecimalField
                                                maxDecimals={4}
                                                onBlur={field.onBlur}
                                                onValueChange={field.onChange}
                                                value={field.value}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name={`ranges.${index}.upperBound` as const}
                                render={({ field }) => (
                                    <FormItem className="w-24">
                                        <FormControl>
                                            <DecimalField
                                                maxDecimals={4}
                                                onBlur={field.onBlur}
                                                onValueChange={field.onChange}
                                                value={field.value}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <Button
                                aria-label="Remove range"
                                disabled={ranges.fields.length <= 1}
                                onClick={() => ranges.remove(index)}
                                size="icon"
                                type="button"
                                variant="ghost"
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    ))}
                </div>

                <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Optional context for these zones." rows={2} {...field} />
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
