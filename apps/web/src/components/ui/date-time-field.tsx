import * as React from "react";

import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DateTimeFieldProps {
    /** Local wall-clock date-time as `YYYY-MM-DDTHH:MM`, or "" when unset. */
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly onBlur?: () => void;
    readonly className?: string;
}

function split(value: string): { date: string; time: string } {
    const [date = "", time = ""] = value.split("T");
    return { date, time };
}

function join(date: string, time: string): string {
    if (date === "") return "";
    return `${date}T${time}`;
}

function maskTime(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    const parts = [digits.slice(0, 2), digits.slice(2, 4)].filter(part => part.length > 0);
    return parts.join(":");
}

/**
 * Local date-time input pairing the masked/calendar {@link DateField} with a
 * masked `HH:MM` time. Emits a wall-clock `YYYY-MM-DDTHH:MM` string (no offset);
 * callers convert to an instant at submit time. Validate on blur so typing is
 * never interrupted mid-keystroke.
 */
export const DateTimeField = React.forwardRef<HTMLInputElement, DateTimeFieldProps>(
    ({ value, onValueChange, onBlur, className }, ref) => {
        const { date, time } = split(value);
        return (
            <div className={cn("flex gap-2", className)}>
                <DateField
                    ref={ref}
                    className="flex-1"
                    onBlur={onBlur}
                    onValueChange={next => onValueChange(join(next, time))}
                    value={date}
                />
                <Input
                    aria-label="Time"
                    autoComplete="off"
                    className="w-24 font-mono tabular-nums"
                    inputMode="numeric"
                    onBlur={onBlur}
                    onChange={event => onValueChange(join(date, maskTime(event.target.value)))}
                    placeholder="HH:MM"
                    value={time}
                />
            </div>
        );
    },
);
DateTimeField.displayName = "DateTimeField";
