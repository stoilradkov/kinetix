import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { exerciseListQueryOptions } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Searchable single-select over the active exercise catalog; emits the chosen exercise id + name. */
export function ExercisePicker({
    onSelect,
    selectedId,
}: {
    readonly onSelect: (exercise: { id: string; name: string }) => void;
    readonly selectedId?: string | null;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const exercises = useQuery(exerciseListQueryOptions(search, "active"));
    const selected = exercises.data?.items.find(item => item.id === selectedId);

    return (
        <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>
                <Button aria-expanded={open} className="w-full justify-between" role="combobox" variant="outline">
                    {selected?.name ?? "Select an exercise…"}
                    <ChevronsUpDown className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command shouldFilter={false}>
                    <CommandInput onValueChange={setSearch} placeholder="Search exercises…" value={search} />
                    <CommandList>
                        {exercises.isPending ? (
                            <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
                                <LoaderCircle className="animate-spin" /> Loading…
                            </div>
                        ) : (
                            <>
                                <CommandEmpty>No exercises found.</CommandEmpty>
                                <CommandGroup>
                                    {exercises.data?.items.map(item => (
                                        <CommandItem
                                            key={item.id}
                                            onSelect={() => {
                                                onSelect({ id: item.id, name: item.name });
                                                setOpen(false);
                                            }}
                                            value={item.id}
                                        >
                                            <Check
                                                className={cn(selectedId === item.id ? "opacity-100" : "opacity-0")}
                                            />
                                            {item.name}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
