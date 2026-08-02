import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, X } from "lucide-react";
import { useForm } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeZoneField } from "@/components/ui/time-zone-field";
import { readinessFields, sessionFormSchema, type SessionFormValues } from "@/lib/session-form";

const readinessLabels: Record<(typeof readinessFields)[number], string> = {
    energy: "Energy",
    motivation: "Motivation",
    fatigue: "Fatigue",
    soreness: "Soreness",
    stress: "Stress",
    recovery: "Recovery",
};

const scaleValues = ["1", "2", "3", "4", "5"] as const;

export function SessionForm({
    defaultValues,
    isSubmitting,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly defaultValues: SessionFormValues;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: SessionFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<SessionFormValues>({
        defaultValues,
        mode: "onTouched",
        resolver: zodResolver(sessionFormSchema),
    });
    const submitting = isSubmitting ?? form.formState.isSubmitting;

    return (
        <Form {...form}>
            <form className="grid gap-6" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Title (optional)</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Upper A" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="localDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Local date</FormLabel>
                                <FormControl>
                                    <DateField onValueChange={field.onChange} value={field.value} />
                                </FormControl>
                                <FormDescription>Defaults to today in the session's zone.</FormDescription>
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
                                <FormDescription>Defaults to your profile zone.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <fieldset className="grid gap-3">
                    <legend className="text-sm font-medium">Pre-workout readiness (1–5)</legend>
                    <div className="grid gap-4 sm:grid-cols-3">
                        {readinessFields.map(name => (
                            <FormField
                                control={form.control}
                                key={name}
                                name={`readiness.${name}`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{readinessLabels[name]}</FormLabel>
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
                                                {scaleValues.map(value => (
                                                    <SelectItem key={value} value={value}>
                                                        {value}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        ))}
                    </div>
                </fieldset>

                <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Tags</FormLabel>
                            <FormControl>
                                <TagsInput onValueChange={field.onChange} value={field.value} />
                            </FormControl>
                            <FormDescription>Case-insensitive; press Enter to add.</FormDescription>
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
                                <Textarea placeholder="How the session felt, context, cues…" rows={2} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {submitError ? (
                    <p className="text-destructive text-sm" role="alert">
                        {submitError.message}
                    </p>
                ) : null}

                <Button disabled={submitting} type="submit">
                    {submitting ? <LoaderCircle className="animate-spin" /> : null}
                    {submitLabel}
                </Button>
            </form>
        </Form>
    );
}

/** Free-form tag chips built from Input + Badge; adds on Enter/comma, removes via the chip button. */
function TagsInput({
    value,
    onValueChange,
}: {
    readonly value: readonly string[];
    readonly onValueChange: (value: string[]) => void;
}): React.JSX.Element {
    const [draft, setDraft] = useState("");

    const add = (raw: string) => {
        const tag = raw.trim();
        if (tag.length === 0) return;
        if (!value.some(existing => existing.toLocaleLowerCase() === tag.toLocaleLowerCase()))
            onValueChange([...value, tag]);
        setDraft("");
    };

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
                onBlur={() => add(draft)}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        add(draft);
                    }
                }}
                placeholder="Add a tag"
                value={draft}
            />
        </div>
    );
}
