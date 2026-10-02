import { randomUUID } from 'node:crypto';

import { describe, expect, inject, it } from 'vitest';

import {
  developmentFiles,
  developmentTestTimeoutMs,
  startDevelopment,
  untilListening,
} from '../testing/development-process.ts';
import {
  greetingSettled,
  notTemporalOn,
  servedWithoutWorkflows,
  startedNothing,
  stoppedWith,
  temporalElsewhere,
} from '../testing/development-workflows.ts';
import { freePort } from '../testing/workflow-process.ts';

const nothingStarted = {
  settled: { status: 'succeeded' },
  exitCode: 0,
  said: ['TEMPORAL_ADDRESS is set, so no Temporal dev server is started'],
};

function envFileWith(settings: Readonly<Record<string, string>>): string {
  const lines = Object.entries(settings).map(([name, value]: readonly [string, string]) => `${name}=${value}\n`);
  return ['HOST=127.0.0.1\n', 'LOCAL_MODE=true\n', ...lines].join('');
}

describe('pnpm dev when Temporal already runs', { timeout: developmentTestTimeoutMs }, () => {
  it('uses a Temporal that already answers on its port and starts none', async () => {
    const port = Number(new URL(`tcp://${inject('temporalAddress')}`).port);
    const development = startDevelopment(developmentFiles(), {
      temporal: { port, uiPort: await freePort() },
      obtain: { unobtainable: 'nothing should be obtained' },
      environment: { TEMPORAL_TASK_QUEUE: `development-${randomUUID()}` },
    });

    const settled = await greetingSettled(await untilListening(development));

    expect({ settled, ...(await stoppedWith(development, 'SIGTERM')) }).toMatchObject({
      settled: { status: 'succeeded' },
      exitCode: 0,
      said: [`Temporal already answers on 127.0.0.1:${port}, so the server uses it`],
    });
  });

  it('starts nothing when TEMPORAL_ADDRESS is set in the shell', async () => {
    const started = startedNothing((temporal) =>
      startDevelopment(developmentFiles(), {
        temporal,
        obtain: { unobtainable: 'nothing should be obtained' },
        environment: temporalElsewhere(),
      }),
    );

    await expect(started).resolves.toMatchObject(nothingStarted);
  });

  it('starts nothing when TEMPORAL_ADDRESS is set in dev.env', async () => {
    const started = startedNothing((temporal) =>
      startDevelopment(developmentFiles(envFileWith(temporalElsewhere())), {
        temporal,
        obtain: { unobtainable: 'nothing should be obtained' },
      }),
    );

    await expect(started).resolves.toMatchObject(nothingStarted);
  });
});

describe('pnpm dev with its port taken or told to be lean', { timeout: developmentTestTimeoutMs }, () => {
  it('starts the server without workflows when something that is not Temporal listens on the port', async () => {
    const port = await freePort();
    await notTemporalOn(port);

    const stopped = servedWithoutWorkflows(
      startDevelopment(developmentFiles(), { temporal: { port, uiPort: await freePort() } }),
    );

    await expect(stopped).resolves.toEqual({
      exitCode: 0,
      said: [
        `Something that is not Temporal is listening on 127.0.0.1:${port}, so the server starts without workflows; free the port and restart, or set TEMPORAL_ADDRESS, to get workflows`,
      ],
    });
  });

  it('starts no Temporal with --lean', async () => {
    await expect(servedWithoutWorkflows(startDevelopment(developmentFiles()))).resolves.toEqual({
      exitCode: 0,
      said: [],
    });
  });
});
