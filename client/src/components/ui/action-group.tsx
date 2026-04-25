import * as React from 'react';

import { cn } from '@/lib/utils';

type ActionGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  columns?: 2 | 3 | 4 | 5;
};

const columnClass: Record<NonNullable<ActionGroupProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

export function ActionGroup({ className, columns, ...props }: ActionGroupProps) {
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-2xl border border-border bg-muted/45 p-1',
        columns ? columnClass[columns] : 'grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]',
        className,
      )}
      {...props}
    />
  );
}
