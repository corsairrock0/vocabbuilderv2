// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { Label, Separator } from './basics.tsx';

type Div = HTMLAttributes<HTMLDivElement>;

function FieldSet({ className, ...props }: HTMLAttributes<HTMLFieldSetElement>) {
  return <fieldset data-slot="field-set" className={cn('flex min-w-0 flex-col gap-5 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3', className)} {...props} />;
}

function FieldLegend({ className, variant = 'legend', ...props }: HTMLAttributes<HTMLLegendElement> & { variant?: 'legend' | 'label' }) {
  return <legend data-slot="field-legend" data-variant={variant} className={cn('mb-2 font-semibold data-[variant=label]:text-sm data-[variant=legend]:text-base', className)} {...props} />;
}

function FieldGroup({ className, ...props }: Div) {
  return <div data-slot="field-group" className={cn('group/field-group @container/field-group flex w-full flex-col gap-6 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4', className)} {...props} />;
}

const fieldVariants = cva('group/field flex w-full gap-3 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col [&>*]:w-full [&>.sr-only]:w-auto',
      horizontal: 'flex-row items-center [&>[data-slot=field-label]]:flex-auto has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio],[role=switch]]:mt-0.5',
      responsive: 'flex-col @md/field-group:flex-row @md/field-group:items-center [&>*]:w-full @md/field-group:[&>*]:w-auto [&>.sr-only]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto',
    },
  },
  defaultVariants: { orientation: 'vertical' },
});

function Field({ className, orientation = 'vertical', ...props }: Div & VariantProps<typeof fieldVariants>) {
  return <div role="group" data-slot="field" data-orientation={orientation} className={cn(fieldVariants({ orientation }), className)} {...props} />;
}

function FieldContent({ className, ...props }: Div) {
  return <div data-slot="field-content" className={cn('group/field-content flex flex-1 flex-col gap-1 leading-snug', className)} {...props} />;
}

/** A field's label; wrapping a radio or checkbox field makes the whole card the choice ("choice card"). */
function FieldLabel({ className, ...props }: HTMLAttributes<HTMLLabelElement>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-xl has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-4',
        'has-data-[state=checked]:border-lang has-data-[state=checked]:bg-lang-soft/70 dark:has-data-[state=checked]:bg-lang-soft/50',
        className,
      )}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: Div) {
  return <div data-slot="field-label" className={cn('flex w-fit items-center gap-2 text-sm leading-snug font-medium group-data-[disabled=true]/field:opacity-50', className)} {...props} />;
}

function FieldDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm leading-normal font-normal text-muted-foreground group-has-[[data-orientation=horizontal]]/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary', className)}
      {...props}
    />
  );
}

function FieldSeparator({ children, className, ...props }: Div) {
  return (
    <div data-slot="field-separator" data-content={!!children} className={cn('relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2', className)} {...props}>
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground" data-slot="field-separator-content">
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({ className, children, errors, ...props }: Div & { errors?: Array<{ message?: string } | undefined>; children?: ReactNode }) {
  const messages = [...new Set((errors ?? []).map((e) => e?.message).filter(Boolean))];
  const content = children ?? (messages.length === 1 ? messages[0] : messages.length ? <ul className="ml-4 flex list-disc flex-col gap-1">{messages.map((m) => <li key={m}>{m}</li>)}</ul> : null);
  if (!content) return null;
  return (
    <div role="alert" data-slot="field-error" className={cn('text-sm font-normal text-destructive', className)} {...props}>
      {content}
    </div>
  );
}

export { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle };
