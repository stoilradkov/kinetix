import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const FALLBACK_TIME_ZONES = [
    "UTC",
    "Europe/London",
    "Europe/Sofia",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
];

function timeZones(): readonly string[] {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    try {
        return supported ? supported("timeZone") : FALLBACK_TIME_ZONES;
    } catch {
        return FALLBACK_TIME_ZONES;
    }
}

export interface TimeZoneFieldProps extends Omit<
    React.ComponentProps<typeof Button>,
    "value" | "onChange" | "children"
> {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
}

/** Searchable dropdown over the IANA time-zone list. Never a free-text input. */
export const TimeZoneField = React.forwardRef<HTMLButtonElement, TimeZoneFieldProps>(
    ({ value, onValueChange, className, ...props }, ref) => {
        const [open, setOpen] = React.useState(false);
        const zones = React.useMemo(() => timeZones(), []);

        return (
            <Popover modal open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        ref={ref}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            "w-full justify-between font-normal",
                            !value && "text-muted-foreground",
                            className,
                        )}
                        {...props}
                    >
                        <span className="truncate">{value || "Select time zone"}</span>
                        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                        <CommandInput placeholder="Search time zones…" />
                        <CommandList>
                            <CommandEmpty>No time zone found.</CommandEmpty>
                            <CommandGroup>
                                {zones.map(zone => (
                                    <CommandItem
                                        key={zone}
                                        value={zone}
                                        onSelect={() => {
                                            onValueChange(zone);
                                            setOpen(false);
                                        }}
                                    >
                                        <Check
                                            className={cn("mr-2 size-4", value === zone ? "opacity-100" : "opacity-0")}
                                        />
                                        {zone}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        );
    },
);
TimeZoneField.displayName = "TimeZoneField";
