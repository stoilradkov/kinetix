import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DecimalFieldProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly maxDecimals?: number;
    readonly suffix?: string;
}

/**
 * Masked decimal input for measurements. Accepts digits and a single decimal
 * point (bounded to `maxDecimals`) and never blocks typing — validate the value
 * on blur (react-hook-form `onTouched`) so the user is not interrupted. An
 * optional unit `suffix` is rendered inside the field.
 */
export const DecimalField = React.forwardRef<HTMLInputElement, DecimalFieldProps>(
    ({ value, onValueChange, maxDecimals = 3, suffix, className, ...props }, ref) => {
        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
            let raw = event.target.value.replace(/[^0-9.]/g, "");
            const dot = raw.indexOf(".");
            if (dot !== -1) {
                const decimals = raw
                    .slice(dot + 1)
                    .replace(/\./g, "")
                    .slice(0, maxDecimals);
                raw = `${raw.slice(0, dot)}.${decimals}`;
            }
            onValueChange(raw);
        };

        return (
            <div className="relative">
                <Input
                    ref={ref}
                    autoComplete="off"
                    inputMode="decimal"
                    value={value}
                    onChange={handleChange}
                    className={cn(suffix ? "pr-9" : undefined, className)}
                    {...props}
                />
                {suffix ? (
                    <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
                        {suffix}
                    </span>
                ) : null}
            </div>
        );
    },
);
DecimalField.displayName = "DecimalField";
