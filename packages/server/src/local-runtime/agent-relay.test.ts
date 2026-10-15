import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Function } from 'effect';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { ranToEnd, spawnRuntimeCommand, type RuntimeCommandRun } from '../testing/processes/runtime-command.ts';
import { spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-agent-')));
});

afterEach(() => {
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

function stoppedAfterwards(port: number): void {
  onTestFinished(async () => {
    await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' }).catch(Function.constVoid);
  });
}

describe('an agent that starts auto-runtime mcp', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('reaches a runtime it starts in the background', async () => {
    const port = await aPortNothingListensOn();
    stoppedAfterwards(port);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initialize));
    await answered(relay, 1);
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
    stoppedAfterwards(port);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    relay.end();
    await relay.exited;

    const status = await ranToEnd(['status'], { home, port });

    expect(status.code).toBe(0);
    expect(status.stdout).toContain('by your agent');
    expect(status.stdout).toContain(`Directory  ${join(home, '.auto-runtime')}`);
    expect(await ranToEnd(['stop'], { home, port })).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
  });
});

describe('an agent whose runtime port another program holds', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('is answered with why it cannot reach the runtime', async () => {
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
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_603,
          message: `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`,
        },
      },
    ]);
    expect(relay.stderr()).toContain(`Another program answers on port ${port}`);
    expect(await relay.exited).toBe(0);
  });
});
