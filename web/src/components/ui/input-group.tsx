// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** shadcn/ui's InputGroup (an input with icons, text or buttons inside its border), ButtonGroup and NativeSelect. */
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';
import { Button, type ButtonProps } from './button.tsx';
import { Separator } from './basics.tsx';

type Div = HTMLAttributes<HTMLDivElement>;

function InputGroup({ className, ...props }: Div) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex h-11 w-full min-w-0 items-center rounded-lg border border-input bg-card shadow-xs transition-[color,box-shadow,border-color] outline-none dark:bg-input/30',
        'has-[>textarea]:h-auto has-[>[data-align=inline-start]]:[&>input]:pl-2 has-[>[data-align=inline-end]]:[&>input]:pr-2 has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col',
        'has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/40',
        'has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-3.5 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]',
        'inline-end': 'order-last pr-3.5 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]',
        'block-start': 'order-first w-full justify-start px-3.5 pt-3 [.border-b]:pb-3 group-has-[>input]/input-group:pt-2.5',
        'block-end': 'order-last w-full justify-start px-3.5 pb-3 [.border-t]:pt-3 group-has-[>input]/input-group:pb-2.5',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
);

function InputGroupAddon({ className, align = 'inline-start', ...props }: Div & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        (e.currentTarget.parentElement?.querySelector('input, textarea') as HTMLElement | null)?.focus();
      }}
      {...props}
    />
  );
}

function InputGroupButton({ className, variant = 'ghost', size = 'icon-sm', ...props }: ButtonProps) {
  return <Button data-size={size} variant={variant} size={size} className={cn('shadow-none', className)} {...props} />;
}

function InputGroupText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("flex items-center gap-2 text-sm text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

function InputGroupInput({ className, ...props }: HTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input-group-control"
      className={cn('h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3.5 py-2 text-base shadow-none outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: HTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-slot="input-group-control" className={cn('field-sizing-content min-h-16 flex-1 resize-none rounded-none border-0 bg-transparent px-3.5 py-3 text-base shadow-none outline-none placeholder:text-muted-foreground', className)} {...props} />;
}

const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal: '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none',
        vertical: 'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
);

function ButtonGroup({ className, orientation, ...props }: Div & VariantProps<typeof buttonGroupVariants>) {
  return <div role="group" data-slot="button-group" data-orientation={orientation} className={cn(buttonGroupVariants({ orientation }), className)} {...props} />;
}

function ButtonGroupSeparator({ className, orientation = 'vertical', ...props }: Div & { orientation?: 'horizontal' | 'vertical' }) {
  return <Separator data-slot="button-group-separator" orientation={orientation} className={cn('relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto', className)} {...props} />;
}

function NativeSelect({ className, size = 'default', ...props }: HTMLAttributes<HTMLSelectElement> & { size?: 'default' | 'sm' }) {
  return (
    <div className="group/native-select relative w-fit has-[select:disabled]:opacity-50" data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          'h-11 w-full min-w-0 appearance-none rounded-lg border border-input bg-card py-2 pr-10 pl-3.5 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-9 data-[size=sm]:text-sm dark:bg-input/30',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          className,
        )}
        {...props}
      />
      <LuChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground opacity-70 select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  );
}

function NativeSelectOption(props: HTMLAttributes<HTMLOptionElement>) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup({ className, ...props }: HTMLAttributes<HTMLOptGroupElement>) {
  return <optgroup data-slot="native-select-optgroup" className={cn(className)} {...props} />;
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea, ButtonGroup, ButtonGroupSeparator, NativeSelect, NativeSelectOption, NativeSelectOptGroup };
