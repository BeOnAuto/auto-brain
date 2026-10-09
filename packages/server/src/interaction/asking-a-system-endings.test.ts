import { describe, expect, it } from 'vitest';

import { askingASystem, systemRunId, type SystemServer } from '../testing/servers/system-calls.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const anyOutput = ['output:', '  schema: {}'];

const calling = (tool: string, written: readonly string[] = []) => ({
  tool,
  read: null,
  with: written,
  output: anyOutput,
});

const anotherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const refusingTheArguments: unknown = expect.stringContaining('The strict tool of chat refused the arguments');

function problemWith(fields: Readonly<Record<string, unknown>>): unknown {
  return expect.objectContaining(fields);
}

async function endedTwice(server: SystemServer) {
  const first = await server.runCall('asking');
  const again = await server.runCall('asking');
  return { first, again, retryAfter: first.headers.get('retry-after') };
}

const hintsOfTools: ReadonlyArray<readonly [string, Readonly<Record<string, boolean>>]> = [
  ['marked readOnlyHint false', { readOnlyHint: false }],
  ['given no hints', {}],
  ['marked destructiveHint false alone', { destructiveHint: false }],
];

describe('a run whose tool is not offered, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is unavailable, 503, never asked to retry, records no call and runs again under its id', async () => {
    const elsewhere = await askingASystem({ entry: { brains: ['beta'] } });
    await elsewhere.define('asking');
    const narrow = await askingASystem({ entry: { allowed: ['search', 'gone'] } });
    await narrow.define('asking');
    await narrow.define('unlisted', calling('gone'));

    const answers = [
      await elsewhere.runCall('asking'),
      await narrow.runCall('asking'),
      await narrow.runCall('unlisted', undefined, anotherRunId),
    ];

    expect(answers.map(({ status, body }) => [status, body])).toEqual([
      [503, problemWith({ kind: 'tool_not_offered', because: 'mcp_server_not_configured' })],
      [503, problemWith({ kind: 'tool_not_offered', because: 'tool_not_allowed' })],
      [503, problemWith({ because: 'tool_not_listed', detail: 'The MCP server chat does not list the tool gone' })],
    ]);
    expect(answers.map(({ headers }) => headers.get('retry-after'))).toEqual([null, null, null]);
    expect([elsewhere.fake.received(), narrow.fake.received(), await narrow.history(systemRunId)]).toMatchObject([
      [],
      [],
      [{ type: 'run_started' }, { type: 'run_rejected' }],
    ]);
    expect((await narrow.runCall('asking')).body).toMatchObject({ kind: 'tool_not_offered' });
  });
});

describe('a run whose tool server cannot be used, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is unavailable, 503, asked to retry in five seconds, whatever wait the server asked for', async () => {
    const server = await askingASystem();
    await server.define('asking');
    server.fake.answerNextOf('tools/list', 429, 1, { 'retry-after': '120' });
    const limited = await server.runCall('asking', undefined, anotherRunId);
    await server.fake.close();

    const { first, again, retryAfter } = await endedTwice(server);

    expect([first.status, first.body, retryAfter]).toEqual([
      503,
      problemWith({ type: 'https://on.auto/problems/unavailable', kind: 'mcp_server_failed', because: 'unreachable' }),
      '5',
    ]);
    expect([limited.body, limited.headers.get('retry-after')]).toEqual([
      problemWith({ kind: 'mcp_server_failed', because: 'rate_limited' }),
      '5',
    ]);
    expect(again.body).toMatchObject({ kind: 'mcp_server_failed' });
  });
});

describe('a run whose tool only reads and could not finish, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is tools_unfinished, 503, never asked to retry, and tools_called under its id', async () => {
    const server = await askingASystem();
    await server.define('asking', calling('denied'));

    const { first, again, retryAfter } = await endedTwice(server);

    expect([first.status, retryAfter, again.status]).toEqual([503, null, 409]);
    expect(first.body).toMatchObject({
      type: 'https://on.auto/problems/tools_unfinished',
      kind: 'tools_unfinished',
      because: 'tool_error',
    });
    expect(again.body).toMatchObject({ type: 'https://on.auto/problems/tools_called', kind: 'tools_called' });
    expect(server.fake.received()).toHaveLength(1);
  });

  it('keeps the wait a 429 asked for past the longest a run waits in its record, and waits out a shorter one', async () => {
    const server = await askingASystem();
    await server.define('asking', calling('search', ['    query: acme']));
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '20' });

    const limited = await server.runCall('asking');
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '2' });
    const waited = await server.runCall('asking', undefined, anotherRunId);
    const read = await server.call('GET', `/v1/orgs/acme/brains/alpha/runs/${systemRunId}`);

    expect([limited.status, limited.headers.get('retry-after'), waited.status]).toEqual([503, null, 200]);
    expect(read.body).toMatchObject({
      rejection: { kind: 'tools_unfinished', because: 'server_failed' },
      record: { retry_after_ms: 20_000 },
    });
  });
});

describe(
  'a run whose tool may have changed something and could not finish, over HTTP',
  { timeout: workflowTestTimeoutMs },
  () => {
    it.each(hintsOfTools)('is effect_unknown, 409 under its own type, for a tool %s', async (_case, hints) => {
      const server = await askingASystem({ hints: { broken: hints } });
      await server.define('asking', calling('broken'));

      const { first, again, retryAfter } = await endedTwice(server);

      expect([first.status, retryAfter, again.status]).toEqual([409, null, 409]);
      expect(first.body).toMatchObject({
        type: 'https://on.auto/problems/effect_unknown',
        title: 'Effect unknown',
        kind: 'effect_unknown',
        because: 'server_failed',
      });
      expect(again.body).toMatchObject({ kind: 'tools_called' });
    });

    it('is unworkable, 409, when the tool refused the arguments, which trying again would meet again', async () => {
      const server = await askingASystem();
      await server.define('asking', calling('strict', ["    limit: '15'"]));

      const { first } = await endedTwice(server);

      expect([first.status, first.body]).toEqual([
        409,
        problemWith({ kind: 'unworkable', detail: refusingTheArguments }),
      ]);
    });
  },
);
