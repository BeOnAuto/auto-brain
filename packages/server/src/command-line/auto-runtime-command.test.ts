import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';

const command = fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url));

const home = mkdtempSync(join(tmpdir(), 'auto-runtime-command-'));

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

interface Started {
  readonly url: string;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly interrupt: () => void;
  readonly exited: Promise<unknown>;
}

async function started(): Promise<Started> {
  const child = spawn(process.execPath, [command], {
    cwd: home,
    env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], PATH: process.env['PATH'], HOME: home, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  const output = { stdout: '', stderr: '' };
  const { promise: ready, resolve } = Promise.withResolvers<string>();
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    if (output.stdout.includes('Press Ctrl+C')) {
      resolve(output.stdout);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  const shown = await ready;
  return {
    url: /Server {3}(http:\/\/localhost:\d+)/u.exec(shown)?.[1] ?? '',
    output: () => ({ ...output }),
    interrupt: () => {
      child.kill('SIGINT');
    },
    exited,
  };
}

describe('the auto-runtime command', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('starts the server in local mode and shows where it answers', async () => {
    const runtime = await started();

    const health = await fetch(`${runtime.url}/health`);
    const playbooks = await fetch(`${runtime.url}/v1/orgs/local/playbooks`);

    expect(await health.json()).toEqual({ status: 'ok' });
    expect(await playbooks.json()).toEqual({ playbooks: [] });
    expect(runtime.output().stdout).toContain(`  ➜  MCP      ${runtime.url}/mcp\n`);
    expect(runtime.output().stdout).toContain('  ➜  Ledger   ~/.auto-runtime/ledger.db\n');
    expect(runtime.output().stderr).toMatch(/^ {2}\d{2}:\d{2}:\d{2} ▲ Local mode is on: /u);
    runtime.interrupt();
    await runtime.exited;
  });

  it('stops cleanly when Ctrl+C reaches it twice at once, as it does through npx', async () => {
    const runtime = await started();

    runtime.interrupt();
    runtime.interrupt();

    expect(await runtime.exited).toBe(0);
    expect(runtime.output().stdout).toMatch(/Stopping…\n {2}✔ Stopped\n$/u);
    expect(runtime.output().stderr).not.toContain('told to stop again');
  });
});
