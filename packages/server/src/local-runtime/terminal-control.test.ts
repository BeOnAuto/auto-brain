import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';
import { spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';

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

describe('a runtime started in a terminal', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('restarts in the same process when asked, and stops when asked', async () => {
    const port = await aPortNothingListensOn();
    const runtime = spawnRuntimeCommand([], { home, port, settings: { LOCAL_MODE: 'true' } });
    onTestFinished(runtime.kill);
    await vi.waitFor(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    }, spawnedServerTestTimeoutMs);
    const before = await statusAt(port);

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await vi.waitFor(() => {
      expect(readiesIn(runtime.stdout())).toBe(2);
    }, spawnedServerTestTimeoutMs);
    const after = await statusAt(port);
    await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' });

    expect(before).toMatchObject({ pid: runtime.pid, started_by: 'terminal', directory: home });
    expect(after.pid).toBe(runtime.pid);
    expect(after.started_at).not.toBe(before.started_at);
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
    }, spawnedServerTestTimeoutMs);

    const answer = await fetch(`http://127.0.0.1:${port}/runtime`);
    runtime.interrupt();

    expect(answer.status).toBe(401);
    expect(await runtime.exited).toBe(0);
  });
});

describe('a runtime started in a terminal on a taken port', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('says why it could not start, and exits', async () => {
    const port = await aPortNothingListensOn();
    const first = spawnRuntimeCommand([], { home, port, settings: { LOCAL_MODE: 'true' } });
    onTestFinished(first.kill);
    await vi.waitFor(() => {
      expect(readiesIn(first.stdout())).toBe(1);
    }, spawnedServerTestTimeoutMs);

    const second = spawnRuntimeCommand([], { home, port, settings: { LOCAL_MODE: 'true' } });

    expect(await second.exited).toBe(1);
    expect(second.stderr()).toContain('Auto Runtime could not start');
  });
});
