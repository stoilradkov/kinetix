import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
    readonly value: string;
    readonly label: string;
}

export interface MultiSelectFieldProps {
    readonly options: readonly MultiSelectOption[];
    readonly value: readonly string[];
    readonly onValueChange: (value: string[]) => void;
    readonly placeholder?: string;
    readonly searchPlaceholder?: string;
    readonly emptyText?: string;
    readonly className?: string;
}

/** Searchable multi-select over a fixed option list; selected values render as removable badges. */
export const MultiSelectField = React.forwardRef<HTMLButtonElement, MultiSelectFieldProps>(
    (
        {
            options,
            value,
            onValueChange,
            placeholder = "Select…",
            searchPlaceholder = "Search…",
            emptyText = "No matches.",
            className,
        },
        ref,
    ) => {
        const [open, setOpen] = React.useState(false);
        const selected = new Set(value);
        const labelFor = (id: string) => options.find(option => option.value === id)?.label ?? id;

        const toggle = (id: string) => {
            onValueChange(selected.has(id) ? value.filter(item => item !== id) : [...value, id]);
        };

        return (
            <div className={cn("flex flex-col gap-2", className)}>
                <Popover modal open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            ref={ref}
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            className="w-full justify-between font-normal"
                        >
                            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
                                {value.length === 0 ? placeholder : `${value.length} selected`}
                            </span>
                            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                        <Command>
                            <CommandInput placeholder={searchPlaceholder} />
                            <CommandList>
                                <CommandEmpty>{emptyText}</CommandEmpty>
                                <CommandGroup>
                                    {options.map(option => (
                                        <CommandItem
                                            key={option.value}
                                            value={option.label}
                                            onSelect={() => toggle(option.value)}
                                        >
                                            <Check
                                                className={cn(
                                                    "mr-2 size-4",
                                                    selected.has(option.value) ? "opacity-100" : "opacity-0",
                                                )}
                                            />
                                            {option.label}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>

                {value.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {value.map(id => (
                            <Badge key={id} variant="secondary" className="gap-1">
                                {labelFor(id)}
                                <button
                                    type="button"
                                    aria-label={`Remove ${labelFor(id)}`}
                                    className="hover:text-foreground -mr-0.5 cursor-pointer opacity-60"
                                    onClick={() => toggle(id)}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    },
);
MultiSelectField.displayName = "MultiSelectField";
