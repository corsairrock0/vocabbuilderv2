// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Composition for the shadcn/ui components, after Base UI's `render` prop (shadcn/ui's default base since July 2026):
 * `<Button render={<Link to="/study" />}>Study</Button>` renders the Link with the button's classes and props.
 * Event handlers are chained (the element's own first), classes joined and styles merged.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

export type RenderProp = ReactElement<any>;

export function mergeProps(base: Record<string, any>, own: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const prev = out[key];
    if (/^on[A-Z]/.test(key) && typeof prev === 'function' && typeof value === 'function') {
      out[key] = (...args: unknown[]) => {
        value(...args);
        prev(...args);
      };
    } else if (key === 'className') out[key] = cn(prev, value);
    else if (key === 'style') out[key] = { ...prev, ...value };
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The `render` element with these props merged in, or the default element when there is none. */
export function renderWith(render: RenderProp | undefined, props: Record<string, any>, fallback: (props: Record<string, any>) => ReactNode): ReactNode {
  if (render && isValidElement(render)) {
    const own = render.props as Record<string, any>;
    const merged = mergeProps(props, own);
    if (own.children === undefined) merged.children = props.children;
    return cloneElement(render, merged);
  }
  return fallback(props);
}
