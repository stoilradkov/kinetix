import * as React from "react";

import { Input } from "@/components/ui/input";

export interface DateFieldProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
}

/**
 * Masked ISO date input (YYYY-MM-DD). Accepts digits only and inserts the
 * hyphens automatically, so the caller always receives a canonical date string.
 * Validate the result on blur (react-hook-form `onTouched`), not per keystroke.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
    ({ value, onValueChange, ...props }, ref) => {
        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
            const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(part => part.length > 0);
            onValueChange(parts.join("-"));
        };

        return (
            <Input
                ref={ref}
                autoComplete="off"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={value}
                onChange={handleChange}
                {...props}
            />
        );
    },
);
DateField.displayName = "DateField";
