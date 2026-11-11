// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
window.addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo({ top: 0 });
  emit();
}

function snapshot() {
  return location.pathname + location.search;
}

export function useLocation() {
  const href = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    snapshot,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link(props: { to: string; className?: string; children?: ReactNode; 'aria-current'?: 'page' | undefined; 'aria-label'?: string; title?: string; onClick?: () => void }) {
  const { to, children, onClick, ...rest } = props;
  return (
    <a
      href={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        const ne = e.nativeEvent;
        if (ne.metaKey || ne.ctrlKey || ne.shiftKey || ne.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
