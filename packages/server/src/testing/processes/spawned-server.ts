import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

export const spawnedServerTestTimeoutMs = 60_000;

export interface SpawnedServer {
  readonly port: Promise<number>;
  readonly exited: Promise<unknown>;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly signal: (name: NodeJS.Signals) => void;
}

function cacheFolderOfTheTest(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-test-cache-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

export function spawnServer(entry: string, env: Readonly<Record<string, string>>): SpawnedServer {
  const child = spawn(process.execPath, [entry], {
    env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], PREDICTION_CACHE_DIR: cacheFolderOfTheTest(), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  const { promise: port, resolve: announce } = Promise.withResolvers<number>();
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    announce(Number(/port (\d+)/u.exec(output.stdout)?.[1]));
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  return {
    port,
    exited,
    output: () => ({ ...output }),
    signal: (name) => {
      child.kill(name);
    },
  };
}
