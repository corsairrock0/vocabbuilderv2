// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Browser acceptance tests: first run, keyboard study, resume after closing the browser,
// cross-device continuation, offline queueing, failed saves, preferences, language isolation, inflection tables
// and practice, Comprehensive study (the default) with its Identify minimum, summary and statistics, reading
// comprehension and its level, Writing and its grading, the offline app shell, and responsive layouts in light and dark
// themes.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from 'playwright/test';
import { expandAnswers } from '../../shared/writing.ts';
import {
  answerCurrent,
  api,
  closeQuietly,
  currentExercise,
  device,
  otherLanguage,
  pageErrors,
  PASSWORD,
  progress,
  serverSession,
  sessionIdFrom,
  switchTo,
  syncStatus,
  USER,
  VIEWPORTS,
  watchErrors,
} from './helpers.ts';

// One test builds on the one before, so a failure stops the run; VB_E2E_KEEP_GOING=1 runs them all anyway, to see
// every failure at once while changing the interface.
if (!process.env.VB_E2E_KEEP_GOING) test.describe.configure({ mode: 'serial' });

// The Russian session the second test starts, which later tests go on with. It is kept in the run's folder too: after
// a failed test (with VB_E2E_KEEP_GOING) the next ones run in a new worker, whose variables start empty.
const RU_SESSION_FILE = join(process.env.VB_E2E_DIR ?? tmpdir(), 'ru-session');
let ruSessionId = existsSync(RU_SESSION_FILE) ? readFileSync(RU_SESSION_FILE, 'utf8') : '';

test('first run: create the owner account, then load a starter set', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL! });
  const page = await context.newPage();
  watchErrors(page);
  await page.goto('/');
  await page.getByLabel('I have read and accept the Terms of Service').check();
  await page.getByLabel('Setup code').fill('wrong-code');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Setup code').fill('E2E-SETUP-TOKEN');
  await page.getByRole('button', { name: 'Create account' }).click();
  // Today: the active language (Spanish at first) has no words yet, and the other five are listed below it.
  await expect(page.getByRole('heading', { name: 'Other languages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Español', level: 1 })).toBeVisible();
  await expect(page.getByText('Add words to start')).toBeVisible();
  for (const [code, name] of [['pt', 'Português'], ['vi', 'Tiếng Việt'], ['ru', 'Русский'], ['uk', 'Українська'], ['pl', 'Polski']]) {
    await expect(otherLanguage(page, code)).toContainText(name);
  }
  // Russian, chosen from the list, gets its starter set; today's session then brings its first new words.
  await switchTo(page, 'ru');
  await expect(page.getByRole('heading', { name: 'Русский', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Load a starter set' }).click();
  await expect(page.getByText(/Added \d+ starter words for Russian/)).toBeVisible();
  await expect(page.getByTestId('today-plan')).toContainText(/[1-9]\d* new words?/);
  // One tap starts today's session; its options are a link away.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Session options' })).toHaveAttribute('href', '/study');
  await expect(page.getByRole('link', { name: /^0 words known/ })).toHaveAttribute('href', '/progress');
  // Spanish, still without words, is now among the languages to add.
  await expect(otherLanguage(page, 'es')).toHaveAccessibleName('Switch to Spanish');
  expect(pageErrors(page)).toEqual([]);
  await closeQuietly(context);
});

test('a session runs from the keyboard and resumes exactly where it stopped after the browser is closed', async ({ browser, baseURL }) => {
  const { context, page } = await device(browser, baseURL!);
  await page.getByRole('link', { name: 'Session options' }).click();
  // Reviews and new words without the practice: this session is also used offline by the tests below.
  await page.getByRole('radio', { name: /^Reviews and new words/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/study\/[\w-]+$/);
  ruSessionId = sessionIdFrom(page);
  writeFileSync(RU_SESSION_FILE, ruSessionId);
  const kinds = new Set<string>();
  for (let i = 0; i < 8; i++) kinds.add((await answerCurrent(page))!.kind);
  expect(kinds.has('intro')).toBe(true);
  const before = await progress(page);
  const next = await currentExercise(page);
  await expect(syncStatus(page, 'All changes saved')).toBeAttached();
  await closeQuietly(context); // close the "browser" without pausing or ending the session

  const again = await device(browser, baseURL!);
  await expect(again.page.getByRole('button', { name: 'Resume session' })).toBeVisible();
  await again.page.getByRole('button', { name: 'Resume session' }).click();
  await expect(again.page).toHaveURL(new RegExp(`/study/${ruSessionId}$`));
  expect(await currentExercise(again.page)).toEqual(next);
  expect(await progress(again.page)).toEqual(before);
  expect(pageErrors(again.page)).toEqual([]);
  await closeQuietly(again.context);
});

test('progress made on a desktop continues on a phone, and back', async ({ browser, baseURL }) => {
  const desk = await device(browser, baseURL!, 'desktop');
  await desk.page.goto(`/study/${ruSessionId}`);
  await answerCurrent(desk.page);
  await answerCurrent(desk.page);
  const deskNext = await currentExercise(desk.page);

  const phone = await device(browser, baseURL!, 'phone');
  await phone.page.getByRole('button', { name: 'Resume session' }).click();
  expect(await currentExercise(phone.page)).toEqual(deskNext);
  await answerCurrent(phone.page);
  const phoneNext = await currentExercise(phone.page);

  await desk.page.reload();
  expect(await currentExercise(desk.page)).toEqual(phoneNext);
  await closeQuietly(phone.context);
  await closeQuietly(desk.context);
});

test('answers given offline are kept, shown as waiting, and synced when the connection returns', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/study/${ruSessionId}`);
  await currentExercise(page);
  const before = (await serverSession(server, ruSessionId)).doneCount;

  await context.setOffline(true);
  await answerCurrent(page);
  await answerCurrent(page);
  await expect(page.getByRole('link', { name: /Offline, 2 changes waiting/ })).toBeAttached();
  expect((await serverSession(server, ruSessionId)).doneCount).toBe(before);

  await context.setOffline(false);
  await expect(syncStatus(page, 'All changes saved')).toBeAttached({ timeout: 20_000 });
  await expect.poll(async () => (await serverSession(server, ruSessionId)).doneCount).toBe(before + 2);
  await server.dispose();
  await closeQuietly(context);
});

test('an answer the server did not accept is never shown or stored as completed', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { context, page } = await device(browser, baseURL!);
  await page.goto(`/study/${ruSessionId}`);
  const target = await currentExercise(page);
  const ATTEMPTS = '**/api/sessions/*/attempts';
  const unavailable = (route: any) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"maintenance","message":"Restarting"}}' });
  const rejected = (route: any) => route.fulfill({ status: 422, contentType: 'application/json', body: '{"error":{"code":"invalid","message":"Rejected for the test"}}' });
  // The server is failing (e.g. restarting): saves are retried, never dropped and never marked done.
  await page.route(ATTEMPTS, unavailable);
  await answerCurrent(page);
  await expect(page.getByRole('link', { name: /Saving|waiting|could not sync/ })).toBeAttached();
  const s1 = await serverSession(server, ruSessionId);
  expect(s1.exercises.find((e: any) => e.id === target!.id).status).toBe('pending');

  // A permanent rejection is surfaced to the user instead of being silently discarded.
  // (The new handler is added before the old one is removed, so no retry can slip through to the real server.)
  await page.route(ATTEMPTS, rejected);
  await page.unroute(ATTEMPTS, unavailable);
  await page.getByRole('link', { name: /Saving|waiting|could not sync/ }).first().click(); // opens Settings → Data and backups
  await page.getByRole('button', { name: 'Sync now' }).click();
  // Only visible matches: a hidden status line can hold the same words and come first in the page.
  await expect(page.getByText(/could not sync|Rejected for the test/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  expect((await serverSession(server, ruSessionId)).exercises.find((e: any) => e.id === target!.id).status).toBe('pending');

  // Once the server accepts it again, retrying saves the answer (a scheduled retry may get there first). As above, the
  // handler that lets requests through comes first: a request caught while the only handler is being removed can hang.
  await page.route(ATTEMPTS, (route) => route.continue());
  await page.unroute(ATTEMPTS, rejected);
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  if (await syncNow.isVisible()) await syncNow.click({ timeout: 2_000 }).catch(() => undefined);
  await expect.poll(async () => (await serverSession(server, ruSessionId)).exercises.find((e: any) => e.id === target!.id).status, { timeout: 20_000 }).toBe('done');
  await server.dispose();
  await closeQuietly(context);
});

test('pronunciation preferences persist across devices', async ({ browser, baseURL }) => {
  const a = await device(browser, baseURL!);
  await a.page.goto('/settings/audio');
  // The settings are for the active language; choosing another here makes it the active one.
  await a.page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  const radio = a.page.getByRole('radiogroup', { name: 'Preferred accent' }).getByRole('radio').nth(1);
  const label = await radio.getAttribute('value');
  await radio.click();
  await expect(radio).toBeChecked();
  await expect(syncStatus(a.page, 'All changes saved')).toBeAttached();
  const b = await device(browser, baseURL!, 'tablet');
  await b.page.goto('/settings/audio');
  await expect(b.page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('ru');
  await expect(b.page.locator(`[role="radio"][value="${label}"]`)).toBeChecked();
  await closeQuietly(a.context);
  await closeQuietly(b.context);
});

test('Settings → Learning shows the memory model: the standard one, and the reviews there are of the number a fit needs', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto('/settings/learning');
  const lang = await page.getByRole('combobox', { name: 'Language', exact: true }).inputValue();
  const status = await (await server.get(`/api/languages/${lang}/memory-model`)).json();
  expect(status.model).toBe('standard');
  expect(status.needed).toBe(1000);
  const card = page.getByTestId('memory-model');
  await expect(card.getByRole('heading', { name: 'Your memory model' })).toBeVisible();
  await expect(card).toHaveAttribute('data-model', 'standard');
  await expect(page.getByTestId('memory-model-state')).toHaveText('Standard');
  // A few answers so far: far from the reviews a fit needs, so there is nothing to fit yet.
  await expect(page.getByTestId('memory-model-progress')).toHaveText(new RegExp(`^${status.reviews} of 1,000 \\p{L}+ reviews$`, 'u'));
  await expect(card.getByRole('button')).toHaveCount(0);
  // The cost of each retention target is worked out with the model in use.
  await page.getByRole('button', { name: 'What each choice costs' }).click();
  await expect(page.getByText(/^Simulated with the standard FSRS-6 parameters/)).toBeVisible();
  expect(await horizontalOverflow(page), 'Learning settings scroll sideways').toBeLessThanOrEqual(0);
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('languages are isolated: a Spanish session leaves the Russian session and statistics untouched', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const ruBefore = await serverSession(server, ruSessionId);
  const { context, page } = await device(browser, baseURL!);
  await switchTo(page, 'es');
  await page.getByRole('button', { name: 'Load a starter set' }).click();
  await expect(page.getByText(/Added \d+ starter words for Spanish/)).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/study\/[\w-]+$/);
  const esId = sessionIdFrom(page);
  expect(esId).not.toBe(ruSessionId);
  for (let i = 0; i < 4; i++) await answerCurrent(page);
  const ruAfter = await serverSession(server, ruSessionId);
  expect(ruAfter.doneCount).toBe(ruBefore.doneCount);
  expect(ruAfter.status).not.toBe('completed');
  expect((await serverSession(server, esId)).language).toBe('es');
  await page.goto('/');
  // Today: the Spanish session (Spanish is active now) and the Russian one, from the other languages, can both be resumed.
  await expect(page.getByRole('heading', { name: 'Español', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume session' })).toBeVisible();
  await expect(page.getByText(/^\d+ of \d+ questions done\.$/)).toBeVisible();
  await expect(otherLanguage(page, 'ru').getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await server.dispose();
  await closeQuietly(context);
});

test('the most frequent Polish words load from Today and show as loaded in settings', async ({ browser, baseURL }) => {
  // Each set holds a little under 6,000 words (crude words were taken out); data/frequency/index.json has the sizes.
  const sets = JSON.parse(readFileSync(new URL('../../data/frequency/index.json', import.meta.url), 'utf8'));
  const size = (code: string) => (sets[code].words as number).toLocaleString('en');
  const { context, page } = await device(browser, baseURL!);
  await switchTo(page, 'pl');
  await page.getByRole('button', { name: `Load the ${size('pl')} most frequent words` }).click();
  await expect(page.getByText(`Added ${size('pl')} of the most frequent Polish words.`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('today-plan')).toContainText(/[1-9]\d* new words?/);
  await page.goto('/settings/data');
  const section = page.getByRole('group', { name: 'Most frequent words' });
  const row = section.locator('li').filter({ hasText: `Polish: ${size('pl')} words` });
  await expect(row.getByText('Loaded')).toBeVisible();
  await expect(row.getByRole('link', { name: 'Sources and skipped words' })).toHaveAttribute('href', '/api/import/frequency-sets/pl/report');
  await expect(section.locator('li').filter({ hasText: `Ukrainian: ${size('uk')} words` }).getByRole('button', { name: 'Load' })).toBeVisible();
  expect(pageErrors(page)).toEqual([]);
  await closeQuietly(context);
});

test('a Polish word shows its declension, and forms and sentence practice grade answers; a word not learned yet stays new', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const found = await (await server.get('/api/vocab?lang=pl&q=kobieta&limit=20')).json();
  const word = found.items.find((e: any) => e.lemma === 'kobieta');
  expect(word, 'kobieta is in the Polish set').toBeTruthy();
  // With Spanish active, the Polish word must still be practiced in Polish.
  const { csrfToken } = await (await server.get('/api/auth/status')).json();
  const switched = await server.put(`/api/settings?changedAt=${Date.now()}`, { data: { activeLanguage: 'es' }, headers: { 'X-CSRF-Token': csrfToken, Origin: baseURL! } });
  expect(switched.status()).toBe(200);
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/words/${word.entryId}`);
  await page.getByRole('tab', { name: 'Forms' }).click();
  const table = page.locator('section[aria-labelledby="paradigm-title"]');
  await expect(table.getByRole('heading', { name: 'Declension' })).toBeVisible();
  await expect(table.getByText('kobietami', { exact: true })).toBeVisible(); // instrumental plural

  // Forms: the questions come from the server's batch, which also says what the right answers are.
  await table.getByRole('link', { name: 'Practice these forms' }).click();
  await expect(page.getByRole('radio', { name: /Only kobieta/ })).toBeChecked();
  const formsBatch = page.waitForResponse((r) => r.url().endsWith('/api/practice/forms/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  const forms = (await (await formsBatch).json()).items;
  expect(forms.length).toBeGreaterThanOrEqual(12);
  expect(new Set(forms.map((i: any) => i.entryId))).toEqual(new Set([word.entryId]));
  // The quiz starts with the word's whole table to review; each case says what it is used for.
  await expect(page.getByRole('heading', { name: 'Look over the table first' })).toBeVisible();
  await expect(page.getByText(/of; after nie ma/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Start the quiz' }).first().click();
  const input = page.getByLabel('Your answer');
  await input.fill(forms[0].answer.accepted[0]);
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();
  await input.fill('xyz');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('heading', { name: 'Not this time' })).toBeVisible();
  await expect(page.locator('[data-slot=feedback-panel]')).toContainText(forms[1].answer.accepted[0]);
  // The answer screen shows the part of the table with the asked form, and offers the rest.
  await expect(page.getByRole('button', { name: 'Show the whole table' })).toBeVisible();
  await expect.poll(async () => (await (await server.get('/api/practice/summary/pl')).json()).forms.attempts7d).toBe(2);

  // Sentence cloze, choosing from four.
  await page.goto(`/practice/cloze?entry=${word.entryId}`);
  await page.getByRole('radio', { name: 'Choosing from four' }).click();
  const clozeBatch = page.waitForResponse((r) => r.url().endsWith('/api/practice/cloze/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  const cloze = (await (await clozeBatch).json()).items;
  expect(cloze.length).toBeGreaterThanOrEqual(1);
  const options = page.getByRole('group', { name: 'Choose the missing word' });
  await expect(options.getByRole('button')).toHaveCount(4);
  await options.getByRole('button', { name: cloze[0].target, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  await page.getByRole('button', { name: 'Show the declension table' }).click();
  await expect(page.getByRole('table').getByText('kobietami', { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await server.get('/api/practice/summary/pl')).json()).cloze.attempts7d).toBe(1);

  // Practice never gives a word its first review (a session introduces it): the word is still new, with nothing due.
  const after = await (await server.get(`/api/vocab/${word.entryId}`)).json();
  expect(after.status).toBe('new');
  expect(after.receptiveDue).toBeNull();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('a Polish verb shows its conjugation, the past by person and gender, and its forms can be practiced', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const found = await (await server.get(`/api/vocab?lang=pl&q=${encodeURIComponent('mieć')}&limit=20`)).json();
  const word = found.items.find((e: any) => e.lemma === 'mieć');
  expect(word, 'mieć is in the Polish set').toBeTruthy();
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/words/${word.entryId}`);
  await page.getByRole('tab', { name: 'Forms' }).click();
  const table = page.locator('section[aria-labelledby="paradigm-title"]');
  await expect(table.getByRole('heading', { name: 'Conjugation' })).toBeVisible();
  await expect(table.getByText('mam', { exact: true })).toBeVisible(); // present, ja
  await expect(table.getByText('miałam', { exact: true })).toBeVisible(); // past, ja (feminine)
  await expect(table.getByText('miejmy', { exact: true })).toBeHidden(); // the imperative is folded away at first
  await table.getByText('Imperative', { exact: false }).first().click();
  await expect(table.getByText('miejmy', { exact: true })).toBeVisible();

  await table.getByRole('link', { name: 'Practice these forms' }).click();
  await expect(page.getByRole('group', { name: 'Verb tenses' }).first()).toBeVisible();
  const formsBatch = page.waitForResponse((r) => r.url().endsWith('/api/practice/forms/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  const forms = (await (await formsBatch).json()).items;
  expect(forms.length).toBeGreaterThanOrEqual(12);
  expect(new Set(forms.map((i: any) => i.entryId))).toEqual(new Set([word.entryId]));
  expect(forms.some((i: any) => i.tense?.label === 'Past' && i.tense?.native === 'czas przeszły')).toBe(true);
  await page.getByRole('button', { name: 'Start the quiz' }).first().click();
  const input = page.getByLabel('Your answer');
  await input.fill(forms[0].answer.accepted[0]);
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('a Portuguese word shows its gender and number table, and forms practice asks for the feminine and the plurals', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { csrfToken } = await (await server.get('/api/auth/status')).json();
  const loaded = await server.post('/api/import/frequency-set', { data: { language: 'pt' }, headers: { 'X-CSRF-Token': csrfToken, Origin: baseURL! }, timeout: 120_000 });
  expect(loaded.status(), await loaded.text()).toBe(200);
  const found = await (await server.get(`/api/vocab?lang=pt&q=${encodeURIComponent('seu')}&limit=20`)).json();
  const word = found.items.find((e: any) => e.lemma === 'seu');
  expect(word, 'seu is in the Portuguese set').toBeTruthy();
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/words/${word.entryId}`);
  await page.getByRole('tab', { name: 'Forms' }).click();
  const table = page.locator('section[aria-labelledby="paradigm-title"]');
  await expect(table.getByRole('heading', { name: 'Gender and number' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /fem/ })).toBeVisible();
  await expect(table.getByText('sua', { exact: true })).toBeVisible();
  await expect(table.getByText('suas', { exact: true })).toBeVisible();
  await expect(table.getByText('Case', { exact: true })).toHaveCount(0);

  await table.getByRole('link', { name: 'Practice these forms' }).click();
  const group = page.getByRole('group', { name: 'Nouns, adjectives and other words' }).first();
  await expect(group.getByRole('button', { name: 'Gender and number' })).toHaveAttribute('aria-pressed', 'true');
  const formsBatch = page.waitForResponse((r) => r.url().endsWith('/api/practice/forms/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  const forms = (await (await formsBatch).json()).items;
  expect(forms.map((i: any) => i.label).sort()).toEqual(['feminine plural', 'feminine singular', 'masculine plural']);
  await page.getByRole('button', { name: 'Start the quiz' }).first().click();
  const input = page.getByLabel('Your answer');
  await input.fill(forms[0].answer.accepted[0]);
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('a sentence gap whose annotation names its case is explained by that case alone, and its table marks only that cell', async ({ browser, baseURL }) => {
  // The server reads tests/fixtures/grammar/ (playwright.config.ts): “kobiecie” in “Powiem tej kobiecie to, co wiem.” is
  // the dative singular. Without the annotation it can be the dative or the locative, and the feedback says so.
  const server = await api(baseURL!);
  const found = await (await server.get('/api/vocab?lang=pl&q=kobieta&limit=20')).json();
  const word = found.items.find((e: any) => e.lemma === 'kobieta');
  expect(word, 'kobieta is in the Polish set').toBeTruthy();
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/practice/cloze?entry=${word.entryId}`);
  await page.getByRole('radio', { name: 'Choosing from four' }).click();
  const batch = page.waitForResponse((r) => r.url().endsWith('/api/practice/cloze/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  const items = (await (await batch).json()).items;
  const at = items.findIndex((i: any) => i.target === 'kobiecie');
  expect(at).toBeGreaterThanOrEqual(0);
  const why = 'it names who “powiem” (I will tell) tells something to, and the person told goes in the dative.';
  expect(items[at].exact).toEqual({ cell: 'dat|sg', why });
  expect(items.filter((i: any) => i.exact)).toHaveLength(1);
  const options = page.getByRole('group', { name: 'Choose the missing word' });
  for (let i = 0; i < at; i++) {
    await options.getByRole('button', { name: items[i].target, exact: true }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
  }
  await options.getByRole('button', { name: 'kobiecie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  await expect(page.getByText(`“kobiecie” is the dative singular of “kobieta”: ${why}`)).toBeVisible();
  await expect(page.getByText(/spelled the same/)).toHaveCount(0);
  await expect(page.getByText(/here: dative singular/)).toBeVisible();
  await page.getByRole('button', { name: 'Show the declension table' }).click();
  await expect(page.getByRole('table').getByText('kobietami', { exact: true })).toBeVisible();
  // kobiecie is the dative and the locative singular; only the sentence's cell is marked.
  await expect(page.locator('mark', { hasText: 'kobiecie' })).toHaveCount(1);
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('sentences written by an AI are marked as such on the word page and in sentence practice', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const found = await (await server.get('/api/vocab?lang=pl&q=tweet&limit=20')).json();
  const word = found.items.find((e: any) => e.lemma === 'tweet');
  expect(word, 'tweet is in the Polish set').toBeTruthy();
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/words/${word.entryId}`);
  await expect(page.getByText('AI-written sentence (Claude), not checked by a native speaker')).toHaveCount(2);
  await page.goto(`/practice/cloze?entry=${word.entryId}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible();
  await expect(page.getByText('AI-written sentence', { exact: true })).toBeVisible();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('Identify: a dot marks a thing in a photo; choosing and typing its Polish name are graded and saved; a word not learned yet stays new', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const found = await (await server.get('/api/vocab?lang=pl&q=szkoła&limit=20')).json();
  const word = found.items.find((e: any) => e.lemma === 'szkoła');
  expect(word, 'szkoła is in the Polish set').toBeTruthy();
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto(`/words/${word.entryId}`);
  await page.getByRole('link', { name: 'Pictures', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Identify', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Only szkoła/ })).toBeChecked();
  await page.getByRole('radio', { name: /All words/ }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  let batch = page.waitForResponse((r) => r.url().endsWith('/api/practice/identify/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  let items = (await (await batch).json()).items;
  expect(items.length).toBe(10);

  // The picture loads, the dot sits where the server put it, and the picture is labelled as AI-generated.
  const img = page.locator('.identify-frame img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
  const dot = page.getByTestId('identify-dot');
  expect(await dot.evaluate((el: HTMLElement) => el.style.left)).toBe(`${items[0].point[1] / 10}%`);
  await expect(page.getByText('AI-generated picture')).toBeVisible();
  const zoom = page.getByRole('button', { name: 'Magnify', exact: true });
  const zoomedAtStart = (await zoom.getAttribute('aria-pressed')) === 'true';
  await zoom.click();
  await expect(page.getByTestId('identify-loupe')).toHaveCount(zoomedAtStart ? 0 : 1);

  // Choosing: the right name, then a wrong one.
  const options = page.getByRole('group', { name: 'Choose its name' });
  await expect(options.getByRole('button')).toHaveCount(4);
  await options.getByRole('button', { name: items[0].display, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();
  const wrong = items[1].choices.find((x: string) => x !== items[1].display);
  await options.getByRole('button', { name: wrong, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Not this time' })).toBeVisible();
  await expect(page.locator('[data-slot=feedback-panel]')).toContainText(items[1].display);
  expect(await horizontalOverflow(page), 'Identify scrolls sideways').toBeLessThanOrEqual(0);
  await expect.poll(async () => (await (await server.get('/api/practice/summary/pl')).json()).identify.attempts7d).toBe(2);

  // Typing: the right word, then a hint and "I don't know".
  await page.goto(`/practice/identify?entry=${word.entryId}`);
  await page.getByRole('radio', { name: /All words/ }).click();
  await page.getByRole('radio', { name: 'Typing the word' }).click();
  batch = page.waitForResponse((r) => r.url().endsWith('/api/practice/identify/batch'));
  await page.getByRole('button', { name: 'Start' }).click();
  items = (await (await batch).json()).items;
  const input = page.getByLabel('Your answer');
  await input.fill(items[0].lemma);
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'Right' })).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByText('In English:')).toContainText(items[1].label);
  await page.getByRole('button', { name: /I don.t know/ }).click();
  await expect(page.getByRole('heading', { name: 'Here it is' })).toBeVisible();
  await expect.poll(async () => (await (await server.get('/api/practice/summary/pl')).json()).identify.attempts7d).toBe(4);

  // Practice never gives a word its first review (a session introduces it): the word is still new, with nothing due.
  const after = await (await server.get(`/api/vocab/${word.entryId}`)).json();
  expect(after.status).toBe('new');
  expect(after.receptiveDue).toBeNull();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('Comprehensive study is the default: practice of every kind comes between exercises, counts as questions, with at least five Identify questions, and shows in the summary and on Progress', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { csrfToken } = await (await server.get('/api/auth/status')).json();
  const switched = await server.put(`/api/settings?changedAt=${Date.now()}`, { data: { activeLanguage: 'pl' }, headers: { 'X-CSRF-Token': csrfToken, Origin: baseURL! } });
  expect(switched.status()).toBe(200);
  const tally = async () => {
    const s = await (await server.get('/api/practice/summary/pl')).json();
    return (s.forms?.attempts7d ?? 0) + (s.cloze?.attempts7d ?? 0) + (s.identify?.attempts7d ?? 0);
  };
  const skills = async () => (await server.get('/api/stats/skills/pl?window=30')).json();
  const before = await tally();
  const skillsBefore = await skills();
  const { context, page } = await device(browser, baseURL!, 'phone');
  // The Identify batches the session asks for, and how many pictures each brought.
  const identify: Array<{ body: any; items: number; words: number[] }> = [];
  page.on('response', async (r) => {
    if (!r.url().endsWith('/api/practice/identify/batch')) return;
    const items = (await r.json()).items as any[];
    identify.push({ body: r.request().postDataJSON(), items: items.length, words: items.map((i) => i.entryId) });
  });
  await page.goto('/study');
  // The start screen: today's mix, every kind of question with its count, at the length chosen.
  const mix = page.getByTestId('mix');
  await expect(page.getByTestId('mix-total')).toHaveText(/^\d+ questions$/);
  // (No Polish word is due yet: no reviews.)
  for (const t of ['new', 'grammar', 'sentences', 'pictures', 'speaking', 'reading']) await expect(mix.locator(`li[data-type="${t}"]`)).toBeVisible();
  const firstTotal = await page.getByTestId('mix-total').textContent();
  await page.getByRole('radiogroup', { name: 'Length', exact: true }).getByRole('radio', { name: '10 min' }).click();
  await expect(page.getByTestId('mix-total')).not.toHaveText(firstTotal!);
  // Comprehensive is the default; the other modes are still offered.
  await expect(page.getByRole('radio', { name: /^Comprehensive/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^Reviews and new words/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /^Reviews only/ })).toBeVisible();
  await page.getByRole('button', { name: /^More/ }).click();
  await expect(page.getByRole('link', { name: 'Practice one skill' })).toHaveAttribute('href', '/practice');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // An unfinished session is ended and this one started.
  const endOld = page.getByRole('button', { name: 'End it and start new' });
  await Promise.race([page.waitForURL(/\/study\/[^/]+$/), endOld.waitFor()]).catch(() => undefined);
  if (await endOld.isVisible()) await endOld.click();
  await page.waitForURL(/\/study\/[^/]+$/);
  const id = sessionIdFrom(page);
  const planned = await serverSession(server, id);
  expect(planned.config.mode).toBe('comprehensive');
  // The practice is planned with the session, in turns: grammar, sentences and pictures (five, for the minimum) first.
  expect(planned.meta.practice.slice(0, 3).map((p: any) => [p.kind, p.size])).toEqual([['forms', 3], ['cloze', 3], ['identify', 5]]);
  // The chrome of the mix: each question's type, and the questions done of the session's total.
  await expect(page.locator('[data-question-type]').first()).toBeVisible();
  await expect(page.getByTestId('session-count')).toHaveText(/^\d+ \/ \d+$/);
  const practice = page.locator('section[data-round]');
  const names: Record<string, string> = { forms: 'Grammar', cloze: 'Sentences', 'cloze-typed': 'Sentences', identify: 'Pictures' };
  /** Answer the practice on screen (declension, sentence gaps or pictures come first; one with nothing is skipped). */
  const answerRound = async () => {
    const kind = (await practice.getAttribute('data-round'))!;
    // This slot, by its id: when the next slot follows at once, it takes this one's place on screen.
    const slot = page.locator(`section[data-round-id="${await practice.getAttribute('data-round-id')}"]`);
    // Over: gone, or still shown (Continue waiting) while what comes next is fetched.
    const open = () => slot.evaluateAll((els) => els.length > 0 && els[0].getAttribute('aria-busy') !== 'true');
    const title = names[kind] ?? kind;
    await expect(page.locator('[data-question-type]').first()).toHaveText(title);
    await expect(page.getByText('Practice round', { exact: true })).toHaveCount(0);
    const note = slot.locator('> p.hint');
    const hint = (await note.count()) ? (await note.textContent())!.trim() : '';
    let answers = 0;
    for (let q = 0; q < 12 && (await open()); q++) {
      const start = page.getByRole('button', { name: 'Start the quiz' }).first();
      if (await start.isVisible()) {
        await start.click();
        continue;
      }
      const counter = await progress(page);
      const input = page.getByLabel('Your answer');
      if (await input.isVisible()) {
        await input.fill('xyz');
        await page.getByRole('button', { name: 'Check' }).click();
      } else await page.getByRole('group', { name: /^Choose/ }).getByRole('button').first().click();
      answers++;
      // Every answer in a round is one of the session's questions: the counter moves at once, and its total (which
      // already held the round's questions) stays.
      await expect.poll(() => progress(page)).toEqual({ done: counter.done + 1, total: counter.total });
      await page.getByRole('button', { name: /^Continue/ }).click();
    }
    // What comes next takes its place in one step (an exercise, the next slot or the summary): nothing answered
    // before is shown again in between.
    await expect(slot).toHaveCount(0);
    return { title, hint, answers };
  };
  // Answer exercises, and the practice between them, until the session has had its pictures.
  const seen: Array<{ title: string; hint: string; answers: number }> = [];
  for (let step = 0; step < 80 && !seen.some((r) => r.title === 'Pictures'); step++) {
    if (await practice.isVisible()) seen.push(await answerRound());
    else if (!(await answerCurrent(page))) await page.waitForTimeout(400);
  }
  expect(seen.map((r) => r.title)).toContain('Pictures');
  await expect(page.locator('[data-exercise]')).toHaveCount(1); // the session goes on
  await expect.poll(tally).toBeGreaterThan(before);
  // The session's first Identify round asked for five pictures, its own words first, filled up from the words being
  // learned and then all the learner's words, and showed all five.
  await expect.poll(() => identify.length).toBeGreaterThan(0);
  expect(identify[0].body).toMatchObject({ language: 'pl', scope: 'entries', size: 5, fill: ['learning', 'all'] });
  expect(identify[0].items).toBe(5);
  const shown = seen.find((r) => r.title === 'Pictures')!;
  expect(shown.answers).toBe(5);
  // A line says where the pictures come from when not only from this session's words.
  const own = identify[0].words.filter((w) => identify[0].body.entryIds.includes(w)).length;
  expect(shown.hint).toBe(own === 5 ? '' : own > 0 ? 'With words from this session and others of yours.' : 'With other words of yours.');

  // The rounds' answers are kept with the session, each once, so a reload (or another device) keeps the count.
  const roundAnswers = (s: any) => Object.values<any>(s.meta.rounds ?? {}).reduce((n, t) => n + t.answered, 0);
  await expect.poll(async () => roundAnswers(await serverSession(server, id))).toBe(seen.reduce((n, r) => n + r.answers, 0));
  expect((await serverSession(server, id)).meta.rounds.identify).toMatchObject({ rounds: 1, answered: 5 });
  await expect(syncStatus(page, 'All changes saved')).toBeAttached();
  const counted = await progress(page);
  expect(counted.done).toBe((await serverSession(server, id)).doneCount + seen.reduce((n, r) => n + r.answers, 0));
  await page.reload();
  await currentExercise(page);
  await expect.poll(async () => (await progress(page)).done).toBe(counted.done);

  // Ending the session: the summary has a row per skill, the pictures with their five answers.
  const rowNames: Record<string, string> = { Grammar: 'Grammar: declension and conjugation', Sentences: 'Sentences', Pictures: 'Pictures' };
  const keys: Record<string, string> = { Grammar: 'forms', Sentences: 'cloze', Pictures: 'identify' };
  const key = keys[seen[0].title];
  await page.getByRole('button', { name: 'Pause or leave the session (Esc)' }).click();
  // The pause menu says how far the session is: questions done, minutes, and answers right so far.
  await expect(page.getByTestId('pause-stats')).toContainText(`${counted.done}/${counted.total}`);
  await expect(page.getByTestId('right-so-far')).toHaveText(/^\d+$/);
  await page.getByRole('button', { name: 'End now and see the summary' }).click();
  await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
  await expect(page.getByText('Next', { exact: true })).toBeVisible(); // the server's summary is in
  const skillRows = page.getByTestId('summary-skills');
  await expect(skillRows.getByRole('heading', { name: 'Every skill today' })).toBeVisible();
  for (const r of seen) await expect(skillRows.locator(`li[data-skill="${keys[r.title]}"]`)).toContainText(new RegExp(`^${rowNames[r.title]}\\d+ of \\d+ right$`));
  await expect(skillRows.locator('li[data-skill="identify"]')).toContainText(/^Pictures\d of 5 right$/);
  await expect(page.getByRole('button', { name: 'Study more' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Done', exact: true })).toHaveAttribute('href', '/');
  // Every question answered is counted once: each answer is in one line of "Skills this session", the lines add up to
  // the figure, and the share answered right covers all of them but the new word cards.
  const answered = Number((await page.getByTestId('questions-answered').textContent())!.replace(/[^\d]/g, ''));
  const lines = page.getByTestId('summary-skills').locator('li[data-answered]');
  let inLines = 0;
  let graded = 0;
  let right = 0;
  for (let i = 0, n = await lines.count(); i < n; i++) {
    const a = Number(await lines.nth(i).getAttribute('data-answered'));
    const r = await lines.nth(i).getAttribute('data-right');
    inLines += a;
    if (r != null) {
      graded += a;
      right += Number(r);
    }
  }
  expect(inLines).toBe(answered);
  await expect(page.getByTestId('answered-right')).toHaveText(`${((right / graded) * 100).toFixed(0)}%`);
  // The same as the session the server keeps; and the counter's final count, less the exercises skipped by ending early.
  const kept = await serverSession(server, id);
  const cards = kept.exercises.filter((e: any) => e.kind === 'intro' && e.status === 'done').length;
  if (cards) await expect(skillRows.locator('li[data-skill="cards"]')).toContainText(new RegExp(`^New word cards${cards} seen`));
  expect(answered - graded).toBe(cards);
  const skippedCount = kept.exercises.filter((e: any) => e.status === 'skipped').length;
  expect(answered).toBe(kept.exercises.filter((e: any) => e.status === 'done').length + roundAnswers(kept));
  // (The summary has no counter: the session's header is gone.)
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveCount(0);
  if (skippedCount) await expect(page.getByText(`${skippedCount.toLocaleString('en')} question${skippedCount === 1 ? '' : 's'} skipped, not counted.`)).toBeVisible();
  expect(await horizontalOverflow(page), 'the summary scrolls sideways').toBeLessThanOrEqual(0);

  // The statistics count the rounds' answers under their skills.
  const skillsAfter = await skills();
  expect(skillsAfter[key].answers).toBeGreaterThan(skillsBefore[key].answers);
  expect(skillsAfter.identify.answers - skillsBefore.identify.answers).toBe(5);
  // The Progress page (the old Stats address leads there) shows them on its skill cards, for the period chosen.
  const period = async (w: string) => (await server.get(`/api/stats/progress/pl/period?window=${w}`)).json();
  await page.goto('/stats/pl');
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  await expect(page.getByTestId('word-counts')).toBeVisible();
  const section = page.getByTestId('skills');
  await expect(section.getByRole('heading', { name: 'Your skills', level: 2 })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Time period' }).getByRole('radio', { name: '30 days' })).toBeChecked();
  const cardOf = { Grammar: 'Grammar', Sentences: 'Sentences', Pictures: 'Pictures' }[seen[0].title as 'Grammar' | 'Sentences' | 'Pictures'];
  const cardKey = { Grammar: 'grammar', Sentences: 'sentences', Pictures: 'pictures' }[seen[0].title as 'Grammar' | 'Sentences' | 'Pictures'];
  const card = section.getByLabel(new RegExp(`^${cardOf}:`));
  const p30 = (await period('30')).skills.find((s: any) => s.key === cardKey);
  expect(p30.answers).toBeGreaterThanOrEqual(skillsAfter[key].answers);
  await expect(card).toContainText(`${p30.answers.toLocaleString('en')} answer`);
  await expect(card).toContainText(`${(p30.accuracy * 100).toFixed(0)}%`);
  expect((await period('30')).skills.find((s: any) => s.key === 'pictures').answers).toBeGreaterThanOrEqual(5);
  // Every skill of a Polish session has its card, each leading to its practice (Reading when the language has texts).
  const keysShown = (await period('30')).skills.map((s: any) => s.key);
  for (const name of ['Words', 'Listening', 'Grammar', 'Sentences', 'Pictures', 'Speaking', 'Writing', ...(keysShown.includes('reading') ? ['Reading'] : [])]) {
    await expect(section.getByLabel(new RegExp(`^${name}:`))).toBeVisible();
  }
  await expect(section.getByLabel(/^Grammar:/)).toHaveAttribute('href', '/practice/forms');
  await expect(section.getByLabel(/^Pictures:/)).toHaveAttribute('href', '/practice/identify');
  // Today's practice answers make today a study day: study time and the words-known chart are drawn.
  const stats = await (await server.get('/api/stats/language/pl')).json();
  expect(stats.history[stats.history.length - 1].practice).toBeGreaterThan(0);
  // Every value of a chart can be read without a mouse: in the line under it (the latest at first, any other by tapping
  // or with the arrow keys) and in a table for screen readers. Days are written as the page writes them.
  const dayIn = (d: string, opts: Intl.DateTimeFormatOptions) => page.evaluate(([d, o]) => new Intl.DateTimeFormat(undefined, { ...o, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)), [d, opts] as const);
  const shortDay = (d: string) => dayIn(d, { weekday: 'short', month: 'short', day: 'numeric' });
  const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const { words } = await (await server.get('/api/stats/progress/pl')).json();
  const knownByDay: number[] = words.history.known;
  const knownLine = async (i: number) => `${await shortDay(plusDays(words.history.firstDay, i))}: ${knownByDay[i].toLocaleString('en')} word${knownByDay[i] === 1 ? '' : 's'} known`;
  const known = page.getByTestId('known-chart');
  const knownChart = known.getByRole('group', { name: new RegExp(`^Words known over the last ${knownByDay.length} days`) });
  await expect(knownChart).toBeVisible();
  await expect(known.getByRole('table', { name: /^Words known over the last/ }).getByRole('row')).toHaveCount(knownByDay.length + 1);
  await expect(known.getByTestId('chart-value')).toHaveText(await knownLine(knownByDay.length - 1));
  await knownChart.tap({ position: { x: 1, y: 50 } });
  await expect(known.getByTestId('chart-value')).toHaveText(await knownLine(0));
  await knownChart.press('ArrowRight');
  await expect(known.getByTestId('chart-value')).toHaveText(await knownLine(1));
  await knownChart.press('End');
  await expect(known.getByTestId('chart-value')).toHaveText(await knownLine(knownByDay.length - 1));
  // Study time counts from the first day Polish was studied when that is later than the period's start (in this run,
  // today), and its chart says so.
  expect(stats.summary.firstStudyDay).not.toBeNull();
  const timeChart = page.getByTestId('study-time-chart');
  const minutesName = (t: any) => new RegExp(`^Minutes studied ${!t.shortened ? `on each of the last ${t.bars.length} days` : t.days === 1 ? 'today, the first day you studied' : `on each of the ${t.days} days since you started`}`);
  const checkTime = async (p: any) => {
    const t = p.time;
    expect([t.begun, t.from, t.shortened, t.bars.length]).toEqual(
      stats.summary.firstStudyDay > p.firstDay ? [stats.summary.firstStudyDay, stats.summary.firstStudyDay, true, t.days] : [stats.summary.firstStudyDay, p.firstDay, false, t.days],
    );
    await expect(timeChart.getByRole('group', { name: minutesName(t) })).toBeVisible();
    await expect(timeChart.getByRole('table').getByRole('row')).toHaveCount(t.bars.length + 1);
    await expect(timeChart.getByTestId('chart-value')).toHaveText(`${await shortDay(t.bars.at(-1).day)}: ${t.bars.at(-1).minutes} min`);
    await timeChart.locator('[data-index="0"]').tap();
    await expect(timeChart.getByTestId('chart-value')).toHaveText(`${await shortDay(t.bars[0].day)}: ${t.bars[0].minutes} min`);
  };
  await checkTime(await period('30'));
  await page.getByRole('radiogroup', { name: 'Time period' }).getByRole('radio', { name: '7 days' }).click();
  await checkTime(await period('7'));
  await expect(card).toContainText(`${(await period('7')).skills.find((s: any) => s.key === cardKey).answers.toLocaleString('en')} answer`);
  // More detail opens the former statistics.
  await page.getByText('Accuracy by question type').click();
  await expect(page.getByText('Study sessions, last 90 days: answers and the share right.')).toBeVisible();
  expect(await horizontalOverflow(page), 'the Progress page scrolls sideways').toBeLessThanOrEqual(0);
  // Today's week shows the same minutes: a ring per day, each with its value in words for screen readers.
  const today = (await period('7')).time.bars.at(-1);
  await page.goto('/');
  const week = page.getByTestId('week-chart');
  await expect(week.getByRole('listitem')).toHaveCount(7);
  await expect(week.getByRole('listitem').last()).toContainText(`${await dayIn(today.day, { weekday: 'long' })}: ${today.minutes} min so far`);
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('Reading comprehension on a phone: Spanish passages and their questions, and the level moving up only with the last A1 text', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { csrfToken } = await (await server.get('/api/auth/status')).json();
  const headers = { 'X-CSRF-Token': csrfToken, Origin: baseURL! };
  const switched = await server.put(`/api/settings?changedAt=${Date.now()}`, { data: { activeLanguage: 'es' }, headers });
  expect(switched.status()).toBe(200);
  const summary = async () => (await server.get('/api/practice/comprehension/summary/es')).json();
  const start = await summary();
  expect(start.level).toBe('A1');
  expect(start.kinds.long.levels[0].total, 'data/reading/es.json has long A1 passages').toBeGreaterThan(1);
  // Every A1 text, long and short, has to be read before the level moves up.
  const a1 = start.progress.total as number;
  expect(start.progress).toEqual({ level: 'A1', total: a1, read: 0 });
  expect(a1).toBeGreaterThan(2);
  // The Spanish starter set was loaded above; the passages do not depend on the words loaded.
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.goto('/practice');
  const tile = page.getByRole('link', { name: /^Reading/ });
  await expect(tile).toContainText(`Level A1 · 0 of ${a1.toLocaleString('en')} texts`);
  await tile.click();
  await expect(page.getByRole('heading', { name: 'Reading comprehension', level: 1 })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'What to read' }).getByRole('radio', { name: /^Longer passages/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Reading level' }).getByRole('radio', { name: 'A1', exact: true })).toBeChecked();
  await expect(page.getByText(`A1 · 0 of ${a1} texts read`)).toBeVisible();
  await expect(page.getByTestId('level-progress')).toContainText('Read every A1 text, of both kinds, to move up to A2.');

  // The passage comes with its questions and right answers: the test reads them from the response.
  const nextText = () => page.waitForResponse((r) => r.url().endsWith('/api/practice/comprehension/next'));
  const first = nextText();
  await page.getByRole('button', { name: 'Start reading' }).click();
  const passage = (await (await first).json()).passage;
  expect(passage.level).toBe('A1');
  await expect(page.getByRole('heading', { name: passage.title })).toBeVisible();
  await expect(page.getByText('AI-written passage', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the translation' })).toHaveCount(0); // only after the questions
  // The questions open in a panel under the text, one at a time; each answer says why at once.
  const onward = (i: number, n: number) => page.getByRole('button', { name: i + 1 < n ? /^Next question/ : /^See your result/ });
  await page.getByRole('button', { name: `Answer ${passage.questions.length} questions` }).click();
  for (const [i, q] of passage.questions.entries()) {
    const options = page.getByRole('group', { name: q.q, exact: true });
    await expect(options.getByRole('button')).toHaveCount(4);
    const right = options.getByRole('button', { name: q.options[q.answer], exact: true });
    await right.click();
    await expect(right).toHaveAttribute('data-state', 'correct');
    await expect(page.getByText(q.explain).first()).toBeVisible();
    await onward(i, passage.questions.length).click();
  }
  // Passed, but a pass alone does not move the level: A1 texts are left.
  await expect(page.getByText('4 of 4 right')).toBeVisible();
  await expect(page.getByText('Passed.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('level-result')).toHaveText(`1 of ${a1} A1 texts read. Read them all to move up to A2.`);
  await page.getByRole('button', { name: 'Show the translation' }).click();
  await expect(page.getByText(passage.titleEn, { exact: true })).toBeVisible();
  expect(await horizontalOverflow(page), 'reading comprehension scrolls sideways').toBeLessThanOrEqual(0);
  await expect.poll(async () => (await summary()).read).toBe(1);
  expect((await summary()).level).toBe('A1');

  // Every other A1 text but one longer passage, read on another device (through the API), all answers wrong.
  const readElsewhere = async (kind: 'short' | 'long', leave: number) => {
    for (;;) {
      const n = await (await server.post('/api/practice/comprehension/next', { data: { language: 'es', kind, level: 'A1' }, headers })).json();
      if (!n.passage || n.passage.level !== 'A1' || n.progress.read >= a1 - leave) return;
      const answers = n.passage.questions.map((q: any) => (q.answer + 1) % q.options.length);
      const r = await server.post('/api/practice/comprehension/attempts', { data: { opId: randomUUID(), language: 'es', passageId: n.passage.id, answers, answeredAt: Date.now() }, headers });
      expect(r.status()).toBe(200);
      expect((await r.json()).levelAfter).toBe('A1');
    }
  };
  await readElsewhere('short', 0);
  await readElsewhere('long', 1);
  expect((await summary()).progress).toEqual({ level: 'A1', total: a1, read: a1 - 1 });

  // The next passage is the last A1 text. Even failed, it moves the level up.
  const second = nextText();
  await page.getByRole('button', { name: /^Next passage/ }).click();
  const last = await (await second).json();
  expect([last.passage.level, last.passage.id === passage.id]).toEqual(['A1', false]);
  expect(last.progress).toEqual({ level: 'A1', total: a1, read: a1 - 1 });
  await expect(page.getByRole('heading', { name: last.passage.title })).toBeVisible();
  await page.getByRole('button', { name: `Answer ${last.passage.questions.length} questions` }).click();
  for (const [i, q] of last.passage.questions.entries()) {
    const options = page.getByRole('group', { name: q.q, exact: true });
    await options.getByRole('button', { name: q.options[(q.answer + 1) % q.options.length], exact: true }).click();
    await onward(i, last.passage.questions.length).click();
  }
  await expect(page.getByText('0 of 4 right')).toBeVisible();
  await expect(page.getByText('Passing takes 3 of 4.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('level-result')).toHaveText('You have read every A1 text: your reading level is now A2.');
  // Saved on the server: the new level holds on every device, and the next passage comes from A2.
  await expect.poll(async () => (await summary()).level).toBe('A2');
  const third = nextText();
  await page.getByRole('button', { name: /^Next passage/ }).click();
  const a2 = (await (await third).json()).passage;
  expect(a2.level).toBe('A2');
  await expect(page.getByRole('heading', { name: a2.title })).toBeVisible();
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('Writing on a phone: Spanish sentences in step order, graded word by word, and "I was right" counting a wrong one', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { csrfToken } = await (await server.get('/api/auth/status')).json();
  const headers = { 'X-CSRF-Token': csrfToken, Origin: baseURL! };
  const switched = await server.put(`/api/settings?changedAt=${Date.now()}`, { data: { activeLanguage: 'es' }, headers });
  expect(switched.status()).toBe(200);
  const summary = async () => (await server.get('/api/practice/writing/summary/es')).json();
  const start = await summary();
  expect(start.level).toBe('A1');
  const a1 = start.progress.total as number;
  expect(a1, 'data/writing/es.json has A1 sentences').toBeGreaterThan(3);
  expect(start.progress).toEqual({ level: 'A1', total: a1, read: 0 });
  const done = (n: number) => `${n} of ${a1.toLocaleString('en')} A1 sentences done. Write them all right to move up to A2.`;
  const { context, page } = await device(browser, baseURL!, 'phone');
  // A Comprehensive session of a language with sentences has Writing in its mix.
  await page.goto('/study');
  await expect(page.getByTestId('mix').locator('li[data-type="writing"]')).toBeVisible();
  await page.goto('/practice');
  const tile = page.getByRole('link', { name: /^Writing/ });
  await expect(tile).toContainText(`Level A1 · 0 of ${a1.toLocaleString('en')} sentences`);
  await tile.click();
  await expect(page.getByRole('heading', { name: 'Writing', level: 1 })).toBeVisible();
  await expect(page.getByText(done(0), { exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Writing level' }).getByRole('radio', { name: 'A1', exact: true })).toBeChecked();

  // The sentences and their accepted translations come with each response: the test reads them from it.
  const nextSentence = () => page.waitForResponse((r) => r.url().endsWith('/api/practice/writing/next'));
  const saved = (what: 'attempts' | 'accept') => page.waitForResponse((r) => r.url().endsWith(`/api/practice/writing/${what}`));
  const main = (s: any) => expandAnswers(s.answers)[0];
  const box = () => page.getByRole('textbox', { name: 'Your answer' });
  const first = nextSentence();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const one = (await (await first).json()).sentence;
  expect([one.level, one.step]).toEqual(['A1', 1]);
  await expect(page.getByText(one.en, { exact: true })).toBeVisible();
  // The usual translation, typed in lower case without its punctuation: capitals and punctuation don't count.
  await box().fill(main(one).toLocaleLowerCase('es').replace(/[¿?¡!.,]/g, ''));
  const firstSaved = saved('attempts');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Right', exact: true })).toBeVisible();
  expect((await (await firstSaved).json()).correct).toBe(true);
  await expect(page.getByText(done(1), { exact: true })).toBeVisible();
  expect(await horizontalOverflow(page), 'Writing scrolls sideways').toBeLessThanOrEqual(0);

  // A word too many: wrong, shown word by word, then counted as right by the learner.
  const second = nextSentence();
  await page.getByRole('button', { name: /^Next sentence/ }).click();
  const two = (await (await second).json()).sentence;
  expect(two.step).toBe(2);
  await expect(page.getByText(two.en, { exact: true })).toBeVisible();
  const mine = `${main(two).replace(/[.!?]$/, '')} zzz`;
  await box().fill(mine);
  const secondSaved = saved('attempts');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Not quite', exact: true })).toBeVisible();
  expect((await (await secondSaved).json()).correct).toBe(false);
  await expect(page.getByTitle('not in the right translation here')).toHaveText('zzz');
  await expect(page.getByText('A right answer', { exact: true })).toBeVisible();
  await expect(page.getByText(done(1), { exact: true })).toBeVisible();
  const accepted = saved('accept');
  await page.getByRole('button', { name: 'I was right' }).click();
  await expect(page.getByRole('heading', { name: 'Counted as right', exact: true })).toBeVisible();
  await expect(page.getByText('Your wording now counts as right for this sentence.')).toBeVisible();
  expect(await (await accepted).json()).toMatchObject({ sentenceId: two.id, correct: true, accepted: true, levelAfter: 'A1' });
  await expect(page.getByText(done(2), { exact: true })).toBeVisible();
  await expect.poll(async () => (await summary()).progress.read).toBe(2);

  // "I don't know" shows the translation and counts as wrong; the sentence stays to be written.
  const third = nextSentence();
  await page.getByRole('button', { name: /^Next sentence/ }).click();
  const three = (await (await third).json()).sentence;
  expect(three.step).toBe(3);
  const thirdSaved = saved('attempts');
  await page.getByRole('button', { name: 'I don’t know' }).click();
  await expect(page.getByRole('heading', { name: 'The translation', exact: true })).toBeVisible();
  await expect(page.getByText(main(three), { exact: true })).toBeVisible();
  expect((await (await thirdSaved).json()).correct).toBe(false);
  const fourth = nextSentence();
  await page.getByRole('button', { name: /^Next sentence/ }).click();
  expect((await (await fourth).json()).sentence.step).toBe(4);
  await page.getByRole('button', { name: 'Done for now' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^\d+ of \d+ right\.$/ })).toHaveText('2 of 3 right.');
  await expect(page.getByText(done(2), { exact: true })).toBeVisible();
  expect((await summary()).progress).toEqual({ level: 'A1', total: a1, read: 2 });
  expect(pageErrors(page)).toEqual([]);
  await server.dispose();
  await closeQuietly(context);
});

test('the sign-in page links to the Terms of Service, and the app shows it is by Lango', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  watchErrors(page);
  await page.goto('/');
  await expect(page.getByText(/by Lango/)).toBeVisible();
  await page.getByRole('link', { name: 'Terms of Service' }).click();
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByText(/may not:/)).toBeVisible();
  await expect(page.getByText(/© 2026 Lango/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(/By signing in you agree to the/)).toBeVisible();
  // Third-party notices: sources, licences and credits, with the full licence texts.
  await page.getByRole('link', { name: 'Third-party notices' }).click();
  await expect(page.getByRole('heading', { name: 'Third-party notices' })).toBeVisible();
  await expect(page.getByText(/Copyright \(c\) 2022 Open Spaced Repetition/)).toBeVisible();
  const licences = await page.request.get('/third-party-notices.txt');
  expect(licences.status()).toBe(200);
  expect(await licences.text()).toContain('Permission is hereby granted');
  const legal = await page.request.get('/api/legal');
  expect((await legal.json()).company).toBe('Lango');
  expect(pageErrors(page)).toEqual([]);
  await closeQuietly(context);
});

test('after one visit the app opens without a connection and shows that it is offline', async ({ browser, baseURL }) => {
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // let the service worker control the page
  await expect(page.getByRole('heading', { name: 'Other languages' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Other languages' })).toBeVisible();
  await expect(page.getByText('Last 7 days', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Offline/ }).first()).toBeAttached();
  await context.setOffline(false);
  await closeQuietly(context);
});

test('starting the app offline, answering, then reconnecting saves every answer in order', async ({ browser, baseURL }) => {
  const server = await api(baseURL!);
  const { context, page } = await device(browser, baseURL!, 'phone');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(`/study/${ruSessionId}`); // online once: the session is cached on the device
  await currentExercise(page);
  const before = (await serverSession(server, ruSessionId)).doneCount;
  await context.setOffline(true);
  await page.reload(); // a cold start without a connection: no sign-in check, no security token yet
  await currentExercise(page);
  await answerCurrent(page);
  await answerCurrent(page);
  await expect(page.getByRole('link', { name: /Offline, 2 changes waiting/ })).toBeAttached();
  await context.setOffline(false);
  await expect(syncStatus(page, 'All changes saved')).toBeAttached({ timeout: 20_000 });
  await expect.poll(async () => (await serverSession(server, ruSessionId)).doneCount).toBe(before + 2);
  await server.dispose();
  await closeQuietly(context);
});

const PAGES = ['/', '/study', '/review', '/words', '/words/new', '/practice', '/practice/writing', '/practice/forms', '/practice/cloze', '/practice/read', '/practice/identify', '/practice/comprehension', '/progress', '/settings', '/settings/general', '/settings/learning', '/settings/audio', '/settings/data', '/settings/account', '/import', '/terms', '/notices'];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const kind of Object.keys(VIEWPORTS) as Array<keyof typeof VIEWPORTS>) {
  test(`the language drop-down opens in full, above the page, and switches language: ${kind}`, async ({ browser, baseURL }) => {
    const { context, page } = await device(browser, baseURL!, kind);
    const button = page.getByRole('button', { name: /^Active language/ }).first();
    await button.click();
    const list = kind === 'phone' ? page.getByRole('dialog', { name: 'Choose a language' }) : page.getByRole('menu', { name: 'Choose a language' });
    await expect(list).toBeVisible();
    for (const code of ['es', 'pt', 'vi', 'ru', 'uk', 'pl']) {
      const option = list.locator(`[data-lang="${code}"]`);
      await expect(option).toBeInViewport();
    }
    // The option on top is the one that gets the click: nothing on the page paints over the list.
    const target = list.locator('[data-lang="ru"]');
    const box = (await target.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-lang]')?.dataset.lang ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe('ru');
    await target.click();
    await expect(list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Active language: Russian. Change language' }).first()).toBeVisible();
    // Keyboard: Escape closes it and the arrow keys move through the list.
    await page.getByRole('button', { name: /^Active language/ }).first().click();
    await expect(list).toBeVisible();
    if (kind !== 'phone') {
      await page.keyboard.press('ArrowDown');
      await expect(list.locator('[data-lang="uk"]')).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    expect(pageErrors(page)).toEqual([]);
    await closeQuietly(context);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`every page renders without errors or sideways scrolling: ${kind}, ${scheme}`, async ({ browser, baseURL }) => {
      const { context, page } = await device(browser, baseURL!, kind, scheme);
      await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /dark/ : /^(?!.*dark)/);
      // The bottom bar (phones) or the side menu: four places; Settings is behind the gear.
      const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
      await expect(kind === 'phone' ? nav.getByRole('button') : nav.getByRole('link')).toHaveText(['Today', 'Practice', 'Words', 'Progress']);
      await expect(page.getByRole('link', { name: 'Settings' }).filter({ visible: true })).toHaveAttribute('href', '/settings');
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.locator('main, [role="main"], h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await horizontalOverflow(page), `${path} scrolls sideways`).toBeLessThanOrEqual(0);
      }
      await page.goto(`/study/${ruSessionId}`);
      await currentExercise(page);
      expect(await horizontalOverflow(page), 'study screen scrolls sideways').toBeLessThanOrEqual(0);
      expect(pageErrors(page)).toEqual([]);
      await closeQuietly(context);
    });
  }
}
