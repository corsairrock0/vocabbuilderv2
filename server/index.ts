// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { startServer } from './main.ts';
import { errorFields, log } from './log.ts';

process.on('unhandledRejection', (err) => log.error('unhandled rejection', errorFields(err)));

startServer()
  .then((running) => {
    const shutdown = (signal: string) => {
      log.info('shutting down', { signal });
      running
        .stop()
        .then(() => process.exit(0))
        .catch((err) => {
          log.error('shutdown failed', errorFields(err));
          process.exit(1);
        });
      setTimeout(() => process.exit(1), 15_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    log.error('failed to start', errorFields(err));
    process.exit(1);
  });
