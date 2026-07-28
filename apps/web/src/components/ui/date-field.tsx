import * as React from "react";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DateFieldProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
    /** ISO date string (YYYY-MM-DD), or "" when unset. */
    readonly value: string;
    readonly onValueChange: (value: string) => void;
}

function parseDate(value: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(year, month - 1, day);
    // Reject impossible dates (e.g. 2020-02-30 rolls over).
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
    return date;
}

function formatDate(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Date input that can be typed (masked YYYY-MM-DD) or picked from a calendar
 * (react-day-picker), which cannot produce an invalid or future date. Pair with
 * live form validation so typed dates are checked as the value completes.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
    ({ value, onValueChange, className, ...props }, ref) => {
        const [open, setOpen] = React.useState(false);
        const selected = parseDate(value);
        const today = new Date();

        const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
            const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(part => part.length > 0);
            onValueChange(parts.join("-"));
        };

        return (
            <div className="relative">
                <Input
                    ref={ref}
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    value={value}
                    onChange={handleInput}
                    className={cn("pr-10", className)}
                    {...props}
                />
                <Popover modal open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Open calendar"
                            className="text-muted-foreground absolute inset-y-0 right-0 h-full rounded-l-none"
                        >
                            <CalendarDays className="size-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-auto p-0">
                        <Calendar
                            mode="single"
                            captionLayout="dropdown"
                            startMonth={new Date(1900, 0)}
                            endMonth={today}
                            defaultMonth={selected ?? today}
                            disabled={{ after: today }}
                            selected={selected}
                            onSelect={date => {
                                if (date) {
                                    onValueChange(formatDate(date));
                                    setOpen(false);
                                }
                            }}
                        />
                    </PopoverContent>
                </Popover>
            </div>
        );
    },
);
DateField.displayName = "DateField";
