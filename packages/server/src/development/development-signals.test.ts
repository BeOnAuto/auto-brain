import { appendFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/development-endings.ts';
import { developmentTestTimeoutMs, untilWritten } from '../testing/development-process.ts';

describe('stopping pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it.each<NodeJS.Signals>(['SIGINT', 'SIGTERM', 'SIGHUP'])(
    'stops the server on %s, leaves nothing running and exits 0',
    async (signal) => {
      const development = await runningDevelopment();

      development.signal(signal);

      await expect(endingOf(development)).resolves.toEqual({ exitCode: 0, alive: [], said: [] });
    },
  );

  it('stops when told to stop while the server restarts', async () => {
    const development = await runningDevelopment();

    appendFileSync(development.files.envFile, '# saved\n');
    await untilWritten(development.stderr, /changed, so the server restarts/u);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      alive: [],
      said: [`${development.files.envFile} changed, so the server restarts`],
    });
  });
});

describe('killing pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('leaves nothing running when the runner itself is killed', async () => {
    const development = await runningDevelopment();

    development.signal('SIGKILL');

    await expect(endingOf(development)).resolves.toEqual({ exitCode: null, alive: [], said: [] });
  });
});
