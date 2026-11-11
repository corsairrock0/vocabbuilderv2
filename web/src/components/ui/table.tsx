// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

function Table({ className, containerClassName, ...props }: HTMLAttributes<HTMLTableElement> & { containerClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn('relative w-full overflow-x-auto', containerClassName)}>
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot data-slot="table-footer" className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />;
}

function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr data-slot="table-row" className={cn('border-b transition-colors data-[state=selected]:bg-muted [@media(hover:hover)]:hover:bg-muted/40', className)} {...props} />;
}

function TableHead({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th data-slot="table-head" className={cn('h-10 px-2 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0', className)} {...props} />;
}

function TableCell({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td data-slot="table-cell" className={cn('p-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />;
}

function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
