import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useForm } from "react-hook-form";

import type { ExerciseCatalogItemResponse } from "@kinetix/types";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    exerciseFormDefaults,
    exerciseFormSchema,
    type ExerciseFormCatalogs,
    type ExerciseFormValues,
} from "@/lib/exercise-form";

export function ExerciseForm({
    catalogs,
    exercise,
    isSubmitting = false,
    onSubmit,
    submitError,
    submitLabel,
}: {
    readonly catalogs: ExerciseFormCatalogs;
    readonly exercise?: ExerciseCatalogItemResponse;
    readonly isSubmitting?: boolean;
    readonly onSubmit: (values: ExerciseFormValues) => Promise<void> | void;
    readonly submitError?: Error | null;
    readonly submitLabel: string;
}): React.JSX.Element {
    const form = useForm<ExerciseFormValues>({
        defaultValues: exerciseFormDefaults(exercise, catalogs),
        mode: "onTouched",
        resolver: zodResolver(exerciseFormSchema),
    });

    return (
        <Form {...form}>
            <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input autoComplete="off" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="slug"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Slug</FormLabel>
                                    <FormControl>
                                        <Input autoCapitalize="none" autoComplete="off" spellCheck={false} {...field} />
                                    </FormControl>
                                    <FormDescription>Lowercase words separated by hyphens.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="aliases"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Aliases</FormLabel>
                                <FormControl>
                                    <Input autoComplete="off" {...field} />
                                </FormControl>
                                <FormDescription>Comma-separated alternative names.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
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
                                            {catalogs.equipment.map(item => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name}
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
                            name="movementPatternId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Movement pattern</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Choose a movement pattern" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {catalogs.movementPatterns.map(item => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <FormField
                            control={form.control}
                            name="classification"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Classification</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="compound">Compound</SelectItem>
                                            <SelectItem value="isolation">Isolation</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="laterality"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Laterality</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="bilateral">Bilateral</SelectItem>
                                            <SelectItem value="unilateral">Unilateral</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="bodyPosition"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Body position</FormLabel>
                                    <FormControl>
                                        <Input autoComplete="off" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="repetitionSemantics"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Repetition semantics</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="total">Total</SelectItem>
                                            <SelectItem value="per_side">Per side</SelectItem>
                                            <SelectItem value="alternating">Alternating</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="loadModel"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Load model</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="external_only">External load</SelectItem>
                                            <SelectItem value="full_bodyweight_plus_added_minus_assistance">
                                                Bodyweight ± load
                                            </SelectItem>
                                            <SelectItem value="manual_effective_load">Manual effective load</SelectItem>
                                            <SelectItem value="none">No load</SelectItem>
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
                            name="primaryMuscleId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Primary muscle</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Choose a primary muscle" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {catalogs.muscles.map(item => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name}
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
                            name="supportedMeasurements"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Measurements</FormLabel>
                                    <FormControl>
                                        <Input autoComplete="off" {...field} />
                                    </FormControl>
                                    <FormDescription>
                                        Comma-separated values such as repetitions and external_load.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Notes</FormLabel>
                                    <FormControl>
                                        <Textarea {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="position"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Position</FormLabel>
                                    <FormControl>
                                        <Input
                                            min="0"
                                            onBlur={field.onBlur}
                                            onChange={event => field.onChange(event.target.valueAsNumber)}
                                            ref={field.ref}
                                            type="number"
                                            value={Number.isNaN(field.value) ? "" : field.value}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {submitError ? (
                    <div
                        className="border-destructive/30 bg-destructive/10 text-destructive mx-6 mt-4 rounded-lg border p-3 text-sm"
                        role="alert"
                    >
                        {submitError.message}
                    </div>
                ) : null}

                <DialogFooter className="border-t p-6">
                    <Button disabled={isSubmitting} type="submit">
                        {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
                        {isSubmitting ? "Saving…" : submitLabel}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
}

export function ExerciseFormLoadState({
    error,
    onRetry,
}: {
    readonly error?: Error | null;
    readonly onRetry: () => void;
}): React.JSX.Element {
    if (!error)
        return (
            <div
                className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm"
                role="status"
            >
                <LoaderCircle className="size-4 animate-spin" />
                Loading exercise options…
            </div>
        );

    return (
        <div
            className="border-destructive/30 bg-destructive/10 flex min-h-48 flex-col items-center justify-center rounded-lg border p-6 text-center"
            role="alert"
        >
            <p className="text-destructive font-medium">Exercise options could not be loaded.</p>
            <p className="text-muted-foreground mt-1 max-w-md text-sm">{error.message}</p>
            <Button className="mt-4" onClick={onRetry} type="button" variant="outline">
                <RotateCcw />
                Try again
            </Button>
        </div>
    );
}
