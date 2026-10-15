import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Function, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { ranToEnd, spawnRuntimeCommand, type RuntimeCommandRun } from '../testing/processes/runtime-command.ts';
import { spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';

let home: string;

interface Runtime {
  readonly port: number;
  readonly pid: number;
}

const inTheBackground: Runtime[] = [];

const pidOf = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Number }));

async function keptTrackOf(port: number): Promise<void> {
  const { pid } = pidOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
  inTheBackground.push({ port, pid });
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stoppedAndGone({ port, pid }: Runtime): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' }).catch(Function.constVoid);
  await vi.waitFor(() => {
    expect(isRunning(pid)).toBe(false);
  }, spawnedServerTestTimeoutMs);
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-agent-')));
});

afterEach(async () => {
  await Promise.all(inTheBackground.splice(0).map((runtime) => stoppedAndGone(runtime)));
  rmSync(home, { recursive: true, force: true });
});

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
};

function answersIn(stdout: string): readonly unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

function answerWithId(answers: readonly unknown[], id: number): unknown {
  return answers.find((answer) => typeof answer === 'object' && answer !== null && 'id' in answer && answer.id === id);
}

function lineOf(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

async function answered(relay: Readonly<RuntimeCommandRun>, count: number): Promise<readonly unknown[]> {
  await vi.waitFor(() => {
    expect(answersIn(relay.stdout())).toHaveLength(count);
  }, spawnedServerTestTimeoutMs);
  return answersIn(relay.stdout());
}

describe('an agent that starts auto-runtime mcp', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('reaches a runtime it starts in the background', async () => {
    const port = await aPortNothingListensOn();
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initialize));
    await answered(relay, 1);
    await keptTrackOf(port);
    relay.write(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    relay.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    relay.write(
      lineOf({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_models', arguments: {} } }),
    );
    const answers = await answered(relay, 3);
    const [initialized, listed, models] = [1, 2, 3].map((id) => answerWithId(answers, id));
    relay.end();

    expect(initialized).toMatchObject({ id: 1, result: { serverInfo: { title: 'Auto Runtime' } } });
    expect(JSON.stringify(listed)).toContain('"name":"list_playbooks"');
    expect(JSON.stringify(models)).toContain(`ANTHROPIC_API_KEY=<their key> in ${join(home, '.auto-runtime', '.env')}`);
    expect(await relay.exited).toBe(0);
  });

  it('leaves that runtime running once the agent leaves, until it is stopped', async () => {
    const port = await aPortNothingListensOn();
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    await keptTrackOf(port);
    relay.end();
    await relay.exited;

    const status = await ranToEnd(['status'], { home, port });

    expect(status.code).toBe(0);
    expect(status.stdout).toContain('by your agent');
    expect(status.stdout).toContain(`Directory  ${join(home, '.auto-runtime')}`);
    expect(await ranToEnd(['stop'], { home, port })).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
  });
});

describe('an agent whose process group is killed', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('leaves the runtime it started running, as it does when some agents end their servers so', async () => {
    const port = await aPortNothingListensOn();
    const relay = spawnRuntimeCommand(['mcp'], { home, port, inAGroupOfItsOwn: true });
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    await keptTrackOf(port);

    relay.killGroup();
    await relay.exited;

    expect(await ranToEnd(['status'], { home, port })).toMatchObject({ code: 0 });
    expect(await ranToEnd(['stop'], { home, port })).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
  });
});

describe('an agent whose runtime restarts', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('has a request it sends while the runtime is down sent again once the runtime is back', async () => {
    const port = await aPortNothingListensOn();
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    await keptTrackOf(port);
    relay.write(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }));

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await vi.waitFor(async () => {
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow('fetch failed');
    }, spawnedServerTestTimeoutMs);
    relay.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const answers = await answered(relay, 2);
    relay.end();

    expect(JSON.stringify(answerWithId(answers, 2))).toContain('"name":"list_playbooks"');
    expect(await relay.exited).toBe(0);
  });
});

function markedAsRestartingBy(pid: number): void {
  mkdirSync(join(home, '.auto-runtime'), { recursive: true });
  writeFileSync(join(home, '.auto-runtime', 'restart-mark.json'), JSON.stringify({ pid, at: Date.now() }));
}

describe('an agent that starts while a runtime restarts', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('waits for that runtime to come back instead of starting a second one', async () => {
    const port = await aPortNothingListensOn();
    markedAsRestartingBy(process.pid);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));

    const runtime = spawnRuntimeCommand([], { home, port });
    onTestFinished(runtime.kill);
    await answered(relay, 1);
    relay.end();
    const status = await ranToEnd(['status'], { home, port });
    runtime.interrupt();

    expect(status.stdout).toContain('in a terminal');
    expect(existsSync(join(home, '.auto-runtime', 'runtime.log'))).toBe(false);
    expect([await relay.exited, await runtime.exited]).toEqual([0, 0]);
  });

  it('starts one when the mark is stale, its process gone', async () => {
    const port = await aPortNothingListensOn();
    markedAsRestartingBy(spawnSync(process.execPath, ['-e', '']).pid);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initialize));
    await answered(relay, 1);
    await keptTrackOf(port);
    relay.end();

    expect((await ranToEnd(['status'], { home, port })).stdout).toContain('by your agent');
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime port another program holds', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('is told why it cannot reach the runtime, and answered once with what its request met', async () => {
    const port = await aPortNothingListensOn();
    const other = createServer((_request, response) => {
      response.end('hello');
    }).listen(port, '127.0.0.1');
    onTestFinished(() => {
      other.close();
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initialize));
    const answers = await answered(relay, 1);
    relay.end();

    expect(answers).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32_603, message: 'SdkError: Unexpected content type: null' } },
    ]);
    expect(relay.stderr()).toContain(
      `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port\n`,
    );
    expect(await relay.exited).toBe(0);
  });
});
