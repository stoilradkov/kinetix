import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { DialogFooter } from "@/components/ui/dialog";
import { HeightField } from "@/components/ui/height-field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimeZoneField } from "@/components/ui/time-zone-field";
import { profileFormSchema, SEX_UNSPECIFIED, type ProfileFormValues } from "@/lib/profile-form";

const massOptions: { value: ProfileFormValues["mass"]; label: string }[] = [
    { value: "kg", label: "Kilograms (kg)" },
    { value: "lb", label: "Pounds (lb)" },
];
const distanceOptions: { value: ProfileFormValues["distance"]; label: string }[] = [
    { value: "km", label: "Kilometres (km)" },
    { value: "mi", label: "Miles (mi)" },
];
const lengthOptions: { value: ProfileFormValues["length"]; label: string }[] = [
    { value: "cm", label: "Centimetres (cm)" },
    { value: "in", label: "Inches (in)" },
];
const sexOptions: { value: ProfileFormValues["sex"]; label: string }[] = [
    { value: SEX_UNSPECIFIED, label: "Prefer not to say" },
    { value: "female", label: "Female" },
    { value: "male", label: "Male" },
    { value: "intersex", label: "Intersex" },
    { value: "other", label: "Other" },
];

export function CoreProfileForm({
    defaultValues,
    isSubmitting = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: ProfileFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: ProfileFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<ProfileFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(profileFormSchema),
    });

    return (
        <Form {...form}>
            <form className="grid gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="timeZone"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Time zone</FormLabel>
                            <FormControl>
                                <TimeZoneField
                                    onBlur={field.onBlur}
                                    onValueChange={field.onChange}
                                    value={field.value}
                                />
                            </FormControl>
                            <FormDescription>IANA time zone used to interpret your entries.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                    <UnitField control={form.control} name="mass" label="Mass" options={massOptions} />
                    <UnitField control={form.control} name="distance" label="Distance" options={distanceOptions} />
                    <UnitField control={form.control} name="length" label="Length" options={lengthOptions} />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                        control={form.control}
                        name="birthDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Birth date</FormLabel>
                                <FormControl>
                                    <DateField
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Optional.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="sex"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Sex</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {sexOptions.map(option => (
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
                        name="heightMeters"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Height</FormLabel>
                                <FormControl>
                                    <HeightField
                                        defaultUnit={form.getValues("length") === "in" ? "ft_in" : "cm"}
                                        onBlur={field.onBlur}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    />
                                </FormControl>
                                <FormDescription>Optional.</FormDescription>
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

function UnitField({
    control,
    name,
    label,
    options,
}: {
    readonly control: ReturnType<typeof useForm<ProfileFormValues>>["control"];
    readonly name: "mass" | "distance" | "length";
    readonly label: string;
    readonly options: readonly { value: string; label: string }[];
}): React.JSX.Element {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {options.map(option => (
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
    );
}
