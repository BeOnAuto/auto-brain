import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';

const patiently = { timeout: 30_000, interval: 10 };

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-terminal-')));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const statusOf = Schema.decodeUnknownSync(
  Schema.Struct({ pid: Schema.Number, started_at: Schema.String, started_by: Schema.String, directory: Schema.String }),
);

async function statusAt(port: number): Promise<ReturnType<typeof statusOf>> {
  return statusOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
}

function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

describe('a runtime started in a terminal', () => {
  it('restarts in the same process when asked, and stops when asked', async () => {
    const port = await aPortNothingListensOn();
    const runtime = spawnRuntimeCommand([], { home, port });
    onTestFinished(runtime.kill);
    await vi.waitFor(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    }, patiently);
    const before = await statusAt(port);

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await vi.waitFor(() => {
      expect(readiesIn(runtime.stdout())).toBe(2);
    }, patiently);
    const after = await statusAt(port);
    await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' });

    expect(before).toMatchObject({ pid: runtime.pid, started_by: 'terminal', directory: home });
    expect(after.pid).toBe(runtime.pid);
    expect(after.started_at).not.toBe(before.started_at);
    expect(existsSync(join(home, '.auto-runtime', 'restart-mark.json'))).toBe(false);
    expect(await runtime.exited).toBe(0);
  });

  it('offers no control, and asks for a credential there as anywhere, when it listens where other computers reach it', async () => {
    const port = await aPortNothingListensOn();
    const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });
    const runtime = spawnRuntimeCommand([], {
      home,
      port,
      settings: { HOST: '0.0.0.0', API_KEYS: JSON.stringify([entry]) },
    });
    onTestFinished(runtime.kill);
    await vi.waitFor(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    }, patiently);

    const answer = await fetch(`http://127.0.0.1:${port}/runtime`);
    runtime.interrupt();

    expect(answer.status).toBe(401);
    expect(await runtime.exited).toBe(0);
  });
});

describe('a runtime started in a terminal on a taken port', () => {
  it('says why it could not start, and exits', async () => {
    const port = await aPortNothingListensOn();
    const first = spawnRuntimeCommand([], { home, port });
    onTestFinished(first.kill);
    await vi.waitFor(() => {
      expect(readiesIn(first.stdout())).toBe(1);
    }, patiently);

    const second = spawnRuntimeCommand([], { home, port });

    expect(await second.exited).toBe(1);
    expect(second.stderr()).toContain('Auto Runtime could not start');
  });
});
