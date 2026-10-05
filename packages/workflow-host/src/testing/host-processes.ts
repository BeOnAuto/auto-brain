import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';

const hostProcess = fileURLToPath(new URL('../../host-process.ts', import.meta.url));

export type Mode = 'hang-on-call' | 'hang-on-settle' | 'finish';

export interface HostProcess {
  readonly said: (line: string) => Promise<void>;
  readonly killed: () => Promise<void>;
  readonly paused: (milliseconds: number) => Promise<void>;
  readonly exited: Promise<unknown>;
}

export function hostIn(settings: DatabaseSettings, mode: Mode, settlements: string, sweepEveryMs = 20): HostProcess {
  const child = spawn(
    process.execPath,
    [hostProcess, JSON.stringify(settings), mode, settlements, String(sweepEveryMs)],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
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
    paused: async (milliseconds) => {
      child.kill('SIGSTOP');
      await setTimeout(milliseconds);
      child.kill('SIGCONT');
    },
    exited,
  };
}

export function linesOf(file: string): readonly unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}
