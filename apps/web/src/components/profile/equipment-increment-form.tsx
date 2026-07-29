import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DecimalField } from "@/components/ui/decimal-field";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { equipmentIncrementFormSchema, type EquipmentIncrementFormValues } from "@/lib/equipment-increment-form";

const scopeOptions: { value: EquipmentIncrementFormValues["scope"]; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "exercise", label: "Exercise" },
    { value: "equipment", label: "Equipment" },
];
const unitOptions = ["kg", "lb"] as const;

export function EquipmentIncrementForm({
    defaultValues,
    exerciseOptions,
    equipmentOptions,
    isSubmitting = false,
    lockScope = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: EquipmentIncrementFormValues;
    readonly exerciseOptions: readonly { value: string; label: string }[];
    readonly equipmentOptions: readonly { value: string; label: string }[];
    readonly isSubmitting?: boolean;
    readonly lockScope?: boolean;
    readonly onSubmit: (values: EquipmentIncrementFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<EquipmentIncrementFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(equipmentIncrementFormSchema),
    });
    const scope = useWatch({ control: form.control, name: "scope" });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="scope"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Scope</FormLabel>
                            <Select disabled={lockScope} onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {scopeOptions.map(option => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormDescription>
                                Most specific scope wins: exercise, then equipment, then default.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {scope === "exercise" ? (
                    <FormField
                        control={form.control}
                        name="exerciseId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Exercise</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
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
                ) : null}

                {scope === "equipment" ? (
                    <FormField
                        control={form.control}
                        name="equipmentTypeId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Equipment</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Choose equipment" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {equipmentOptions.map(option => (
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

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="incrementValue"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Increment</FormLabel>
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
                        name="incrementUnit"
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
                                        {unitOptions.map(unit => (
                                            <SelectItem key={unit} value={unit}>
                                                {unit}
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
                        name="minimumValue"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Minimum</FormLabel>
                                <FormControl>
                                    <DecimalField
                                        maxDecimals={3}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Optional bar / base weight.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="label"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Label</FormLabel>
                                <FormControl>
                                    <Input placeholder="Barbell, Stack…" {...field} />
                                </FormControl>
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
