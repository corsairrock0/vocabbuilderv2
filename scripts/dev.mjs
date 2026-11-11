// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Development mode: rebuilds the web client on every change and restarts the server when server or
// shared code changes. Data lives in ./storage/dev (git-ignored). Open http://localhost:3000.
//
//   npm run dev                      (first start prints the one-time setup code)
//   VB_PORT=3100 npm run dev         (any VB_* variable can be overridden)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { watchWeb } from './build-web.mjs';

const root = path.resolve(import.meta.dirname, '..');
const web = await watchWeb(() => console.log(`[web] rebuilt at ${new Date().toLocaleTimeString()}`));
const env = {
  VB_DATA_DIR: path.join(root, 'storage', 'dev', 'data'),
  VB_BACKUP_DIR: path.join(root, 'storage', 'dev', 'backups'),
  VB_HOST: '127.0.0.1',
  VB_PORT: '3000',
  VB_BACKUPS_ENABLED: 'false',
  VB_LOG_LEVEL: 'info',
  ...process.env,
};
const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', '--watch-path=server', '--watch-path=shared', '--watch-preserve-output', 'server/index.ts'],
  { cwd: root, env, stdio: 'inherit' },
);
const stop = async () => {
  server.kill('SIGTERM');
  await web.dispose();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => {
  if (code && code !== 0) console.error(`[server] exited with code ${code}`);
});
