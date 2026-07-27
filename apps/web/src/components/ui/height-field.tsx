import * as React from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type HeightUnit = "cm" | "m" | "ft_in";

export interface HeightFieldProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
    /** Canonical height in metres (e.g. "1.780"), or "" when unset. */
    readonly value: string;
    readonly onValueChange: (metres: string) => void;
    readonly defaultUnit?: HeightUnit;
}

const IN_PER_M = 1 / 0.0254;

function round3(value: number): string {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value * 1000) / 1000);
}

function maskDecimal(raw: string, maxDecimals: number): string {
    let next = raw.replace(/[^0-9.]/g, "");
    const dot = next.indexOf(".");
    if (dot !== -1)
        next = `${next.slice(0, dot)}.${next
            .slice(dot + 1)
            .replace(/\./g, "")
            .slice(0, maxDecimals)}`;
    return next;
}

function maskInt(raw: string): string {
    return raw.replace(/\D/g, "").slice(0, 3);
}

function displayFromMetres(metres: string, unit: HeightUnit): { single: string; feet: string; inches: string } {
    const value = metres === "" ? Number.NaN : Number(metres);
    if (!Number.isFinite(value)) return { single: "", feet: "", inches: "" };
    if (unit === "m") return { single: metres, feet: "", inches: "" };
    if (unit === "cm") return { single: round3(value * 100), feet: "", inches: "" };
    const totalInches = value * IN_PER_M;
    let feet = Math.floor(totalInches / 12);
    let inches = Math.round(totalInches - feet * 12);
    if (inches === 12) {
        feet += 1;
        inches = 0;
    }
    return { single: "", feet: String(feet), inches: String(inches) };
}

function toMetres(unit: HeightUnit, single: string, feet: string, inches: string): string {
    if (unit === "m") return single;
    if (unit === "cm") return single === "" ? "" : round3(Number(single) / 100);
    if (feet === "" && inches === "") return "";
    return round3((Number(feet || "0") * 12 + Number(inches || "0")) * 0.0254);
}

function Suffix({ children }: { children: string }): React.JSX.Element {
    return (
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
            {children}
        </span>
    );
}

/**
 * Height input with a unit selector (cm, m, ft/in). Displays and edits in the
 * chosen unit but always emits a canonical value in metres. Validate on blur.
 */
export const HeightField = React.forwardRef<HTMLInputElement, HeightFieldProps>(
    ({ value, onValueChange, defaultUnit = "cm", className, onBlur, ...props }, ref) => {
        const [unit, setUnit] = React.useState<HeightUnit>(defaultUnit);
        const initial = displayFromMetres(value, defaultUnit);
        const [single, setSingle] = React.useState(initial.single);
        const [feet, setFeet] = React.useState(initial.feet);
        const [inches, setInches] = React.useState(initial.inches);

        const changeUnit = (next: HeightUnit) => {
            const display = displayFromMetres(value, next);
            setSingle(display.single);
            setFeet(display.feet);
            setInches(display.inches);
            setUnit(next);
        };
        const changeSingle = (raw: string) => {
            const masked = maskDecimal(raw, unit === "m" ? 3 : 1);
            setSingle(masked);
            onValueChange(toMetres(unit, masked, feet, inches));
        };
        const changeFeet = (raw: string) => {
            const next = maskInt(raw);
            setFeet(next);
            onValueChange(toMetres(unit, single, next, inches));
        };
        const changeInches = (raw: string) => {
            const next = maskInt(raw);
            setInches(next);
            onValueChange(toMetres(unit, single, feet, next));
        };

        return (
            <div className={cn("flex gap-2", className)}>
                {unit === "ft_in" ? (
                    <>
                        <div className="relative min-w-0 flex-1">
                            <Input
                                ref={ref}
                                autoComplete="off"
                                className="pr-8"
                                inputMode="numeric"
                                onBlur={onBlur}
                                onChange={event => changeFeet(event.target.value)}
                                placeholder="5"
                                value={feet}
                                {...props}
                            />
                            <Suffix>ft</Suffix>
                        </div>
                        <div className="relative min-w-0 flex-1">
                            <Input
                                autoComplete="off"
                                className="pr-8"
                                inputMode="numeric"
                                onBlur={onBlur}
                                onChange={event => changeInches(event.target.value)}
                                placeholder="10"
                                value={inches}
                            />
                            <Suffix>in</Suffix>
                        </div>
                    </>
                ) : (
                    <div className="relative min-w-0 flex-1">
                        <Input
                            ref={ref}
                            autoComplete="off"
                            className="pr-9"
                            inputMode="decimal"
                            onBlur={onBlur}
                            onChange={event => changeSingle(event.target.value)}
                            placeholder={unit === "m" ? "1.78" : "178"}
                            value={single}
                            {...props}
                        />
                        <Suffix>{unit}</Suffix>
                    </div>
                )}
                <Select onValueChange={next => changeUnit(next as HeightUnit)} value={unit}>
                    <SelectTrigger className="w-28">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="cm">cm</SelectItem>
                        <SelectItem value="m">m</SelectItem>
                        <SelectItem value="ft_in">ft / in</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        );
    },
);
HeightField.displayName = "HeightField";
