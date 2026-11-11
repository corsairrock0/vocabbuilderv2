// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/*
 * Minimal React 19 type declarations.
 *
 * @types/react could not be installed in the offline environment this project was built in, so this file declares
 * the subset of the React API the app uses, with real event types for DOM handlers (so handlers are type-checked).
 * With network access: `npm i -D @types/react@19 @types/react-dom@19`, delete this file, and run `npm run typecheck`.
 */
declare module 'react' {
  export type Key = string | number | bigint;
  export interface ReactElement<P = any, T = any> {
    type: T;
    props: P;
    key: string | null;
  }
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode> | Promise<ReactNode>;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly unknown[]): T;
  export interface MutableRefObject<T> {
    current: T;
  }
  export interface RefObject<T> {
    current: T | null;
  }
  // Bivariant (as in @types/react), so a ref typed for a <div> can be passed where an HTMLElement ref is expected.
  export type RefCallback<T> = { bivarianceHack(instance: T | null): void | (() => void) }['bivarianceHack'];
  export type Ref<T> = RefCallback<T> | RefObject<T> | MutableRefObject<T | null> | null;
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T>;
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
  export function useId(): string;
  export function useDeferredValue<T>(v: T): T;
  export interface Context<T> {
    Provider: FC<{ value: T; children?: ReactNode }>;
  }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(ctx: Context<T>): T;
  export type FC<P = {}> = (props: P) => ReactNode;
  export function memo<T>(c: T): T;
  export function lazy<T extends (props: any) => any>(f: () => Promise<{ default: T }>): T;
  export const Suspense: FC<{ fallback?: ReactNode; children?: ReactNode }>;
  export const Fragment: FC<{ children?: ReactNode }>;
  export const StrictMode: FC<{ children?: ReactNode }>;
  export function startTransition(cb: () => void): void;
  export function cloneElement<P>(element: ReactElement<P>, props?: Partial<P> & Record<string, any>, ...children: ReactNode[]): ReactElement<P>;
  export function isValidElement<P = any>(object: unknown): object is ReactElement<P>;
  export const Children: {
    toArray(children: ReactNode): Array<Exclude<ReactNode, boolean | null | undefined>>;
    count(children: ReactNode): number;
    only(children: ReactNode): ReactElement;
  };
  export function useImperativeHandle<T>(ref: Ref<T> | undefined, init: () => T, deps?: readonly unknown[]): void;
  export type CSSProperties = { [property: string]: string | number | undefined };

  export interface SyntheticEvent<T = Element, E = Event> {
    currentTarget: EventTarget & T;
    target: EventTarget;
    nativeEvent: E;
    type: string;
    preventDefault(): void;
    stopPropagation(): void;
    isDefaultPrevented(): boolean;
    defaultPrevented: boolean;
  }
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {
    target: EventTarget & T;
  }
  export type FormEvent<T = Element> = SyntheticEvent<T>;
  export type FocusEvent<T = Element> = SyntheticEvent<T, globalThis.FocusEvent> & { relatedTarget: EventTarget | null };
  export interface UIModifiers {
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }
  export type KeyboardEvent<T = Element> = SyntheticEvent<T, globalThis.KeyboardEvent> & UIModifiers & { key: string; code: string; repeat: boolean };
  export type MouseEvent<T = Element> = SyntheticEvent<T, globalThis.MouseEvent> & UIModifiers & { clientX: number; clientY: number; button: number; detail: number };
  export type PointerEvent<T = Element> = MouseEvent<T> & { pointerId: number; pointerType: string };
  export type TouchEvent<T = Element> = SyntheticEvent<T, globalThis.TouchEvent> & { touches: TouchList; changedTouches: TouchList };
  export type MediaEvent<T = Element> = SyntheticEvent<T>;

  /** Attributes shared by all DOM elements. Unlisted attributes (aria-*, data-*, …) fall through to the index signature. */
  export interface DOMAttributes<T> {
    [attribute: string]: any;
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    id?: string;
    ref?: Ref<T>;
    onClick?(event: MouseEvent<T>): void;
    onDoubleClick?(event: MouseEvent<T>): void;
    onMouseDown?(event: MouseEvent<T>): void;
    onMouseUp?(event: MouseEvent<T>): void;
    onPointerDown?(event: PointerEvent<T>): void;
    onPointerUp?(event: PointerEvent<T>): void;
    onPointerMove?(event: PointerEvent<T>): void;
    onPointerCancel?(event: PointerEvent<T>): void;
    onTouchStart?(event: TouchEvent<T>): void;
    onTouchMove?(event: TouchEvent<T>): void;
    onTouchEnd?(event: TouchEvent<T>): void;
    onKeyDown?(event: KeyboardEvent<T>): void;
    onKeyUp?(event: KeyboardEvent<T>): void;
    onFocus?(event: FocusEvent<T>): void;
    onBlur?(event: FocusEvent<T>): void;
    onChange?(event: ChangeEvent<T>): void;
    onInput?(event: FormEvent<T>): void;
    onSubmit?(event: FormEvent<T>): void;
    onScroll?(event: SyntheticEvent<T>): void;
    onLoad?(event: SyntheticEvent<T>): void;
    onError?(event: SyntheticEvent<T>): void;
    onEnded?(event: MediaEvent<T>): void;
    onToggle?(event: SyntheticEvent<T>): void;
  }
  export type HTMLAttributes<T> = DOMAttributes<T>;
  export type SVGAttributes<T> = DOMAttributes<T>;

  export namespace JSX {
    type ElementType = string | ((props: any) => ReactNode | Promise<ReactNode>);
    interface Element extends ReactElement<any, any> {}
    interface ElementClass {
      render(): ReactNode;
    }
    interface ElementAttributesProperty {
      props: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: Key | null;
    }
    interface IntrinsicElements {
      [tag: string]: DOMAttributes<HTMLElement>;
      input: DOMAttributes<HTMLInputElement>;
      select: DOMAttributes<HTMLSelectElement>;
      textarea: DOMAttributes<HTMLTextAreaElement>;
      form: DOMAttributes<HTMLFormElement>;
      button: DOMAttributes<HTMLButtonElement>;
      a: DOMAttributes<HTMLAnchorElement>;
      audio: DOMAttributes<HTMLAudioElement>;
      details: DOMAttributes<HTMLDetailsElement>;
      img: DOMAttributes<HTMLImageElement>;
      svg: DOMAttributes<SVGSVGElement>;
      rect: DOMAttributes<SVGRectElement>;
      path: DOMAttributes<SVGPathElement>;
    }
  }
}

declare module 'react/jsx-runtime' {
  import type { JSX as ReactJSX } from 'react';
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type ElementType = ReactJSX.ElementType;
    interface Element extends ReactJSX.Element {}
    interface ElementClass extends ReactJSX.ElementClass {}
    interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}

declare module 'react-dom' {
  export function createPortal(children: import('react').ReactNode, container: Element | DocumentFragment): import('react').ReactNode;
}

declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: import('react').ReactNode): void; unmount(): void };
}

declare module '@tanstack/react-virtual' {
  export interface VirtualItem {
    index: number;
    key: string | number;
    start: number;
    size: number;
    end: number;
  }
  export function useVirtualizer(opts: {
    count: number;
    getScrollElement: () => Element | null;
    estimateSize: (i: number) => number;
    overscan?: number;
  }): { getVirtualItems(): VirtualItem[]; getTotalSize(): number; measureElement: (el: Element | null) => void };
  export function useWindowVirtualizer(opts: { count: number; estimateSize: (i: number) => number; overscan?: number; scrollMargin?: number }): {
    getVirtualItems(): VirtualItem[];
    getTotalSize(): number;
    measureElement: (el: Element | null) => void;
    options: { scrollMargin: number };
  };
}

declare module '*.css';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
