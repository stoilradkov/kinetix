import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide uppercase whitespace-nowrap",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground",
                secondary: "bg-secondary text-secondary-foreground",
                outline: "border-border text-foreground",
                success: "bg-success-muted text-success",
                milestone: "bg-milestone text-milestone-foreground",
                info: "bg-info-muted text-info",
                warning: "bg-warning-muted text-warning",
                destructive: "bg-destructive/10 text-destructive",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
