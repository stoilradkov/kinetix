import * as React from "react";

import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">): React.JSX.Element {
    return (
        <div className="relative w-full overflow-auto">
            <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
        </div>
    );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">): React.JSX.Element {
    return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">): React.JSX.Element {
    return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">): React.JSX.Element {
    return (
        <tr
            className={cn("hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors", className)}
            {...props}
        />
    );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">): React.JSX.Element {
    return (
        <th
            className={cn("text-muted-foreground h-10 px-2 text-left align-middle font-medium", className)}
            {...props}
        />
    );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">): React.JSX.Element {
    return <td className={cn("p-2 align-middle", className)} {...props} />;
}
