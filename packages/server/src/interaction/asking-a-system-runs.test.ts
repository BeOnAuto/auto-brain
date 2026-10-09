import { callDocument } from '@beonauto/interaction/testing';
import { fakeStdioServerPath, stdioTestTimeoutMs } from '@beonauto/mcp/testing';
import { describe, expect, it } from 'vitest';

import { interactionServerOn } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { askingASystem, systemRunId } from '../testing/servers/system-calls.ts';
import { until } from '../testing/servers/workflow-calls.ts';
import { settledRun, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const anyOutput = ['output:', '  schema: {}'];

const open = ['input:', '  schema: { type: object }'];

function runIdOf(count: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7${count}`;
}

const measured = { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] ?? '' };

const takingTheBytes: unknown = expect.stringContaining('take 16415 bytes');

const notARequest: unknown = expect.stringContaining('The run is not a request');

function problemWith(fields: Readonly<Record<string, unknown>>): unknown {
  return expect.objectContaining(fields);
}

const calling = (tool: string, written: readonly string[] = []) => ({
  tool,
  read: null,
  with: written,
  output: anyOutput,
});

describe('a run that asks a system with an input it cannot use, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is refused before anything is sent, 422 for its input and 409 for arguments it cannot send', async () => {
    const server = await askingASystem();
    await server.define('asking');
    await server.define('reading', { input: open });
    await server.define('filtered', { with: ["    channel: '{{ input.channel | divided_by: 0 }}'"] });
    await server.define('among', { with: ["    channel: 'In {{ input.channel }}'"], input: open });
    await server.define('large', { with: ["    a: '{{ input.a }}'", "    b: '{{ input.b }}'"], input: open });

    const answers = [
      await server.runCall('asking', { channel: 7 }, runIdOf(1)),
      await server.runCall('reading', { channel: 'C0123' }, runIdOf(2)),
      await server.runCall('filtered', undefined, runIdOf(3)),
      await server.runCall('among', { channel: ['C0123'] }, runIdOf(4)),
      await server.runCall('large', { a: 'x'.repeat(8200), b: 'x'.repeat(8200) }, runIdOf(5)),
    ];

    expect(answers.map(({ status, body }) => [status, body])).toEqual([
      [422, problemWith({ reason: 'invalid_input' })],
      [422, problemWith({ detail: 'The definition reads a field the input does not have' })],
      [422, problemWith({ detail: 'The argument channel of the call cannot be rendered with this input' })],
      [409, problemWith({ kind: 'unworkable' })],
      [409, problemWith({ kind: 'unworkable', detail: takingTheBytes })],
    ]);
    expect(server.fake.received()).toEqual([]);
  });
});

describe('a run that asks a system whose session or process is gone', { timeout: workflowTestTimeoutMs }, () => {
  it('opens a session its server forgot once more, and answers', async () => {
    const server = await askingASystem();
    await server.define('asking');
    server.fake.answerNextOf('tools/call', 404);

    expect(await server.runCall('asking')).toMatchObject({ status: 200, body: { status: 'succeeded' } });
  });

  it(
    'starts a process that exited once more, after a call that ended it could not say whether it changed something',
    { timeout: stdioTestTimeoutMs },
    async () => {
      const server = await interactionServerOn({
        MCP_SERVERS: JSON.stringify({
          notes: {
            command: process.execPath,
            args: [fakeStdioServerPath],
            env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
            org: 'acme',
          },
        }),
        ...measured,
      });
      await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
      const define = (name: string, tool: string, written: readonly string[] = []) =>
        server.call('POST', `${alpha}/definitions/interaction`, {
          body: { name, source: callDocument({ server: 'notes', input: open, ...calling(tool, written) }) },
        });
      await define('exiting', 'exit');
      await define('searching', 'search', ['    query: acme']);

      const exited = await server.call('POST', `${alpha}/definitions/interaction/exiting/run`, { body: { input: {} } });
      const restarted = await server.call('POST', `${alpha}/definitions/interaction/searching/run`, {
        body: { input: {} },
      });

      expect([exited.status, exited.body]).toEqual([
        409,
        expect.objectContaining({ kind: 'effect_unknown', because: 'server_failed' }),
      ]);
      expect(restarted.body).toMatchObject({ status: 'succeeded', output: 'Found 2 rows for acme.' });
    },
  );
});

describe('a run that asks a system while its call is in flight', { timeout: workflowTestTimeoutMs }, () => {
  it('goes on to its end when its caller goes away, records the answer, and is no request anyone can answer', async () => {
    const server = await askingASystem();
    await server.define('sleeping', { ...calling('sleep', ['    ms: 1500']), input: open });
    const path = `${server.origin}${alpha}/definitions/interaction/sleeping/run`;
    const leaving = fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {}, run_id: systemRunId }),
      signal: AbortSignal.timeout(300),
    });
    await expect(leaving).rejects.toThrow('The operation was aborted due to timeout');
    await until(
      () => Promise.resolve(server.fake.received().length),
      (received) => received === 1,
    );

    const cancelling = await server.call('POST', `${alpha}/runs/${systemRunId}/cancel`, { body: { reason: 'Stop' } });
    const answering = await server.call('POST', `${alpha}/runs/${systemRunId}/answer`, { body: { answer: {} } });
    const ended = await settledRun(server, `${alpha}/runs/${systemRunId}`);
    const listed = await server.call('GET', `${alpha}/interactions`);

    expect([cancelling.status, answering.status]).toEqual([409, 409]);
    expect(answering.body).toMatchObject({ detail: notARequest });
    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Slept.' });
    expect((await server.history(systemRunId)).map(({ type }) => type)).toEqual([
      'run_started',
      'tool_call_started',
      'tool_call_answered',
      'run_succeeded',
    ]);
    expect(listed.body).toMatchObject({ interactions: [] });
  });
});
