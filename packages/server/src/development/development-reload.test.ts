import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endingOf, pidOf, runningWithTemporal, temporalAddressOf } from '../testing/development-endings.ts';
import {
  aliveGroups,
  developmentTestTimeoutMs,
  pidsOf,
  untilListening,
  untilWritten,
  writeServerEntry,
} from '../testing/development-process.ts';
import { whatAnswersOn } from './temporal-answer.ts';

const runnerSays = /changed, so the server restarts$|^The server stopped/u;

describe('saving a file under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('restarts the server once through its clean shutdown; Temporal keeps running and answering', async () => {
    const development = await runningWithTemporal();
    const temporal = pidOf(development, 'temporal');

    writeFileSync(join(development.files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    const answer = await whatAnswersOn(temporalAddressOf(development));
    const alive = aliveGroups(development);
    development.signal('SIGTERM');

    expect({ answer, temporalAlive: alive.includes(temporal), recorded: pidsOf(development).length }).toEqual({
      answer: 'Temporal',
      temporalAlive: true,
      recorded: 6,
    });
    await expect(endingOf(development)).resolves.toMatchObject({
      exitCode: 0,
      alive: [],
      said: [`${join(development.files.sourceDirectory, 'saved.ts')} changed, so the server restarts`],
    });
  });
});

describe('a broken save under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('keeps running when the server cannot start, and starts it on the next save', async () => {
    const development = await runningWithTemporal();

    writeServerEntry(development.files, 'this is not TypeScript (\n');
    await untilWritten(development.stderr, /The server stopped \(exit code 1\)/u);
    writeServerEntry(development.files);
    await untilListening(development, 2);
    development.signal('SIGTERM');

    const { exitCode, alive, said } = await endingOf(development);

    expect({ exitCode, alive, said: said.filter((line) => runnerSays.test(line)) }).toEqual({
      exitCode: 0,
      alive: [],
      said: [
        `${development.files.serverEntry} changed, so the server restarts`,
        'The server stopped (exit code 1); it starts again when a file changes',
        `${development.files.serverEntry} changed, so the server restarts`,
      ],
    });
  });
});

describe('a server crash under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('keeps Temporal running when the server crashes, and starts the server on the next save', async () => {
    const development = await runningWithTemporal();

    process.kill(pidOf(development, 'server'), 'SIGKILL');
    await untilWritten(development.stderr, /The server stopped \(signal SIGKILL\)/u);
    appendFileSync(development.files.envFile, '# saved\n');
    await untilListening(development, 2);
    const answer = await whatAnswersOn(temporalAddressOf(development));
    development.signal('SIGTERM');

    expect(answer).toBe('Temporal');
    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      alive: [],
      temporal: 'nothing',
      said: [
        'The server stopped (signal SIGKILL); it starts again when a file changes',
        `${development.files.envFile} changed, so the server restarts`,
      ],
    });
  });
});
