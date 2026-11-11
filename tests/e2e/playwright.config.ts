// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// End-to-end tests in a real browser against a real server with a throwaway data folder.
// Run: npm run test:e2e   (builds the web client first)
import { defineConfig } from 'playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VB_E2E_PORT ?? 4610);
// Created once in the runner process; workers inherit the variable.
process.env.VB_E2E_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'vb-e2e-'));
const dir = process.env.VB_E2E_DIR;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: path.join(dir, 'results'),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/index.ts',
    cwd: path.resolve(import.meta.dirname, '../..'),
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VB_PORT: String(PORT),
      VB_HOST: '127.0.0.1',
      VB_DATA_DIR: path.join(dir, 'data'),
      VB_BACKUP_DIR: path.join(dir, 'backups'),
      VB_SETUP_TOKEN: 'E2E-SETUP-TOKEN',
      VB_SCRYPT_N: '1024',
      VB_BACKUPS_ENABLED: 'false',
      VB_PUBLIC_ORIGIN: BASE_URL,
      VB_LOG_LEVEL: 'warn',
      // One annotated Polish sentence (tests/fixtures/grammar/src/pl.jsonl), whatever data/grammar/ holds.
      VB_GRAMMAR_DIR: path.resolve(import.meta.dirname, '../fixtures/grammar'),
    },
  },
});
