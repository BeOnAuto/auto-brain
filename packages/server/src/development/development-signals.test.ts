import { appendFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { endingOf, pidOf, runningWithTemporal } from '../testing/development-endings.ts';
import {
  developmentFiles,
  developmentTestTimeoutMs,
  localTemporalPorts,
  runnerLines,
  startDevelopment,
  untilGone,
  untilWritten,
} from '../testing/development-process.ts';

describe('stopping pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it.each<NodeJS.Signals>(['SIGINT', 'SIGTERM', 'SIGHUP'])(
    'stops the server and Temporal on %s, leaves nothing running and exits 0',
    async (signal) => {
      const development = await runningWithTemporal();

      development.signal(signal);

      await expect(endingOf(development)).resolves.toEqual({ exitCode: 0, alive: [], temporal: 'nothing', said: [] });
    },
  );

  it('stops both when told to stop while the server restarts', async () => {
    const development = await runningWithTemporal();

    appendFileSync(development.files.envFile, '# saved\n');
    await untilWritten(development.stderr, /changed, so the server restarts/u);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      alive: [],
      temporal: 'nothing',
      said: [`${development.files.envFile} changed, so the server restarts`],
    });
  });
});

describe('killing or starving pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('leaves nothing running when the runner itself is killed', async () => {
    const development = await runningWithTemporal();

    development.signal('SIGKILL');

    await expect(endingOf(development)).resolves.toEqual({ exitCode: null, alive: [], temporal: 'nothing', said: [] });
  });

  it('starts nothing when told to stop while the Temporal CLI is being obtained', async () => {
    const development = startDevelopment(developmentFiles(), {
      temporal: await localTemporalPorts(),
      obtain: 'held until stopped',
    });

    await untilWritten(development.stderr, /Holding the Temporal CLI/u);
    development.signal('SIGTERM');

    expect({ exitCode: await development.exited, alive: await untilGone(development) }).toEqual({
      exitCode: 0,
      alive: [],
    });
    expect(runnerLines(development)).toEqual(['Holding the Temporal CLI until the runner is told to stop']);
  });
});

describe('Temporal stopping under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('stops the server when Temporal stops on its own, saying so, and exits 1', async () => {
    const development = await runningWithTemporal();

    process.kill(pidOf(development, 'temporal'), 'SIGKILL');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 1,
      alive: [],
      temporal: 'nothing',
      said: ["Temporal's dev server stopped (signal SIGKILL), so the server stops too"],
    });
  });
});
