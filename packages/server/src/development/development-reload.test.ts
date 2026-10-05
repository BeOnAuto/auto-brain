import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/development-endings.ts';
import {
  developmentTestTimeoutMs,
  pidsOf,
  untilListening,
  untilWritten,
  writeServerEntry,
} from '../testing/development-process.ts';

const runnerSays = /changed, so the server restarts$|^The server stopped/u;

describe('saving a file under pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('restarts the server once through its clean shutdown, and leaves nothing running when stopped', async () => {
    const development = await runningDevelopment();

    writeFileSync(join(development.files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      alive: [],
      said: [`${join(development.files.sourceDirectory, 'saved.ts')} changed, so the server restarts`],
    });
    expect(pidsOf(development)).toHaveLength(4);
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
