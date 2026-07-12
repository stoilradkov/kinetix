import * as React from 'react';

import { cn } from '../../lib/utils';

export function Input({
  className,
  type,
  ...props
}: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-sm transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}
