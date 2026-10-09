import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  developmentTestTimeoutMs,
  pidsOf,
  startDevelopment,
  untilListening,
  untilWritten,
  writeServerEntry,
} from '../testing/processes/development-process.ts';
import { gatewayThatHangsFirst, settledOver, welcomingStarted } from '../testing/processes/workflow-process.ts';

const runnerSays = /changed, so the server restarts$|^The server stopped/u;

describe('saving a file under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('restarts the server once through its clean shutdown, and leaves nothing running when stopped', async () => {
    const development = await runningDevelopment();

    writeFileSync(join(development.files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      allStopped: true,
      said: [`${join(development.files.sourceDirectory, 'saved.ts')} changed, so the server restarts`],
    });
    expect(pidsOf(development)).toHaveLength(2);
  });
});

describe('a broken save under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('keeps running when the server cannot start, and starts it on the next save', async () => {
    const development = await runningDevelopment();

    writeServerEntry(development.files, 'this is not TypeScript (\n');
    await untilWritten(development.stderr, /The server stopped \(exit code 1\)/u);
    writeServerEntry(development.files);
    await untilListening(development, 2);
    development.signal('SIGTERM');

    const { exitCode, allStopped, said } = await endingOf(development);

    expect({ exitCode, allStopped, said: said.filter((line) => runnerSays.test(line)) }).toEqual({
      exitCode: 0,
      allStopped: true,
      said: [
        `${development.files.serverEntry} changed, so the server restarts`,
        'The server stopped (exit code 1); it starts again when a file changes',
        `${development.files.serverEntry} changed, so the server restarts`,
      ],
    });
  });
});

describe('a server crash under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('keeps running when the server dies while a workflow waits on a function, and on the next save the run goes on', async () => {
    const gateway = await gatewayThatHangsFirst();
    const development = startDevelopment(developmentFiles(), { environment: { MODEL_GATEWAYS: gateway.gateways } });
    const runId = await welcomingStarted(await untilListening(development), 'delta');
    await gateway.firstHeard;

    development.signal('SIGUSR2');
    await untilWritten(development.stderr, /The server stopped \(signal SIGKILL\)/u);
    appendFileSync(development.files.envFile, '# saved\n');
    const settled = await settledOver(await untilListening(development, 2), `/delta/runs/${runId}`);
    development.signal('SIGTERM');

    expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
    expect(gateway.requests()).toBe(2);
    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      allStopped: true,
      said: [
        'The server stopped (signal SIGKILL); it starts again when a file changes',
        `${development.files.envFile} changed, so the server restarts`,
      ],
    });
  });
});
