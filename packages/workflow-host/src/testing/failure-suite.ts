import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { aSQLiteFile, type SettingsOf } from './host-files.ts';

const hostProcess = fileURLToPath(new URL('../../host-process.ts', import.meta.url));

type Mode = 'hang-on-call' | 'hang-on-settle' | 'finish';

interface HostProcess {
  readonly said: (line: string) => Promise<void>;
  readonly killed: () => Promise<void>;
  readonly exited: Promise<unknown>;
}

function hostIn(settings: DatabaseSettings, mode: Mode, settlements: string): HostProcess {
  const child = spawn(process.execPath, [hostProcess, JSON.stringify(settings), mode, settlements], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const output = { said: '' };
  const heard = Promise.withResolvers<void>();
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.said += chunk;
    heard.resolve();
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  return {
    said: async (line) => {
      await heard.promise;
      expect(output.said).toContain(line);
    },
    killed: async () => {
      child.kill('SIGKILL');
      await exited;
    },
    exited,
  };
}

function linesOf(file: string): readonly unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

const settledOnce = [
  { id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', settlement: { status: 'succeeded', output: 'sent', record: {} } },
];

const hangs: readonly { readonly mode: Mode; readonly line: string; readonly title: string }[] = [
  { mode: 'hang-on-call', line: 'calling', title: 'starts again the call it was running, and settles the run once' },
  {
    mode: 'hang-on-settle',
    line: 'settling',
    title: 'dispatches again the settlement it was recording, and settles the run once',
  },
];

export function failureSuite(settings: SettingsOf): void {
  it.each(hangs)(
    '$title',
    async ({ mode, line }) => {
      const database = await settings();
      const settlements = join(aSQLiteFile(), '..', 'settlements.jsonl');
      const killedHost = hostIn(database, mode, settlements);
      await killedHost.said(line);
      await killedHost.killed();

      expect(await hostIn(database, 'finish', settlements).exited).toBe(0);
      expect(linesOf(settlements)).toEqual(settledOnce);
    },
    60_000,
  );
}
