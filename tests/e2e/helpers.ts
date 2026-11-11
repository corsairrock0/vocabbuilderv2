// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { expect, request, type APIRequestContext, type Browser, type BrowserContext, type Page } from 'playwright/test';

export const USER = 'owner';
export const PASSWORD = 'correct horse battery staple';

export const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: false, hasTouch: true },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
} as const;

/** A fresh browser profile (like a second device) that is signed in. */
export async function device(browser: Browser, baseURL: string, kind: keyof typeof VIEWPORTS = 'desktop', colorScheme: 'light' | 'dark' = 'light') {
  const { width, height, isMobile, hasTouch } = VIEWPORTS[kind];
  const context = await browser.newContext({ baseURL, viewport: { width, height }, isMobile, hasTouch, colorScheme });
  const page = await context.newPage();
  watchErrors(page);
  await page.goto('/');
  await signIn(page);
  return { context, page };
}

/** Another language on Today: its row (a language with words) or its chip in "Add a language" (one without). */
export function otherLanguage(page: Page, code: string) {
  return page.getByRole('region', { name: 'Other languages' }).locator(`[data-lang="${code}"]`);
}

/** Makes another language the active one from Today's list. */
export async function switchTo(page: Page, code: string) {
  const el = otherLanguage(page, code);
  await expect(el).toBeVisible();
  if ((await el.evaluate((n) => n.tagName)) === 'BUTTON') await el.click();
  else await el.getByRole('button', { name: /^Switch to/ }).click();
}

/** Signs in when asked, and waits for Today (its list of the other languages). */
export async function signIn(page: Page) {
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  const home = page.getByRole('heading', { name: 'Other languages' });
  await expect(signInButton.or(home).first()).toBeVisible();
  if (await signInButton.isVisible()) {
    await page.getByLabel('Username').fill(USER);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await signInButton.click();
  }
  await expect(home).toBeVisible();
}

/**
 * The sync status ("All changes saved", "Offline, 2 changes waiting"…), a link to Settings → Data. In a session or a
 * practice run the bars that hold it are hidden while everything is saved, so it is looked up hidden or not.
 */
export function syncStatus(page: Page, name: string | RegExp) {
  return page.getByRole('link', { name, includeHidden: true }).first();
}

const errors = new WeakMap<Page, string[]>();
/** Collects uncaught page errors; expected network failures in offline tests are not page errors. */
export function watchErrors(page: Page) {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
}
export function pageErrors(page: Page): string[] {
  return errors.get(page) ?? [];
}

/** The id and kind of the exercise on screen, or null when the session is finished. */
export async function currentExercise(page: Page): Promise<{ id: string; kind: string } | null> {
  const el = page.locator('[data-exercise]');
  const summary = page.getByRole('heading', { name: 'Session complete' });
  await expect(el.or(summary).first()).toBeVisible();
  if (await summary.isVisible()) return null;
  return { id: (await el.getAttribute('data-exercise'))!, kind: (await el.getAttribute('data-kind'))! };
}

/** Answer whatever exercise is on screen using the keyboard where the app offers shortcuts. */
export async function answerCurrent(page: Page, opts: { typed?: string } = {}): Promise<{ id: string; kind: string } | null> {
  const ex = await currentExercise(page);
  if (!ex) return null;
  const scope = page.locator(`[data-exercise="${ex.id}"]`);
  if (ex.kind === 'intro') {
    await page.keyboard.press('Enter');
  } else if (await scope.getByRole('button', { name: 'Skip this question' }).isVisible()) {
    await scope.getByRole('button', { name: 'Skip this question' }).click();
  } else if (ex.kind === 'speak_flashcard') {
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
  } else if (ex.kind === 'sentence_create') {
    await scope.locator('textarea').fill('Test sentence');
    await scope.getByRole('button', { name: 'Compare with examples' }).click();
    await page.keyboard.press('3');
  } else if (ex.kind === 'shadowing') {
    await scope.getByRole('button', { name: 'Sounded close' }).click();
  } else if (await scope.locator('[data-slot=option]').count()) {
    await page.keyboard.press('1');
    await expect(scope.getByRole('button', { name: /Continue/ })).toBeVisible();
    await page.keyboard.press('Enter');
  } else {
    const input = scope.locator('input[type="text"], input:not([type]), textarea').first();
    await input.fill(opts.typed ?? 'xyz');
    await page.keyboard.press('Enter');
    await expect(scope.getByRole('button', { name: /Continue/ })).toBeVisible();
    await page.keyboard.press('Enter');
  }
  await expect(page.locator(`[data-exercise="${ex.id}"]`)).toHaveCount(0);
  return ex;
}

/** "done/total" from the session header. */
export async function progress(page: Page): Promise<{ done: number; total: number }> {
  const bar = page.getByRole('progressbar', { name: 'Session progress' });
  return { done: Number(await bar.getAttribute('aria-valuenow')), total: Number(await bar.getAttribute('aria-valuemax')) };
}

/** A signed-in API client that talks to the server directly (unaffected by browser offline emulation). */
export async function api(baseURL: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const r = await ctx.post('/api/auth/login', { data: { username: USER, password: PASSWORD } });
  expect(r.status()).toBe(200);
  return ctx;
}

export async function serverSession(ctx: APIRequestContext, id: string) {
  const r = await ctx.get(`/api/sessions/${id}`);
  expect(r.status()).toBe(200);
  const s = await r.json();
  return { ...s, doneCount: s.exercises.filter((e: any) => e.status !== 'pending').length } as any;
}

export const sessionIdFrom = (page: Page) => new URL(page.url()).pathname.split('/')[2];

export async function closeQuietly(context: BrowserContext) {
  await context.close().catch(() => undefined);
}
