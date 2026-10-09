import { setTimeout } from 'node:timers/promises';

import { createApiKey } from '@beonauto/identity';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { allPermissions } from '@beonauto/operations';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, brains: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read', 'brain:read'], brains: '*' });

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
}

async function serving(): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingReasoning([], {
    API_KEYS: JSON.stringify([builder.entry, reader.entry]),
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
        org: 'acme',
      },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { key: builder.key, body: { brain: 'alpha', name: 'Alpha' } });
  return { server, graph };
}

function testOf(server: ReasoningServer, tool: string, body: unknown = {}, key = builder.key) {
  return server.call('POST', `${alpha}/tool-servers/graph/tools/${tool}/test`, { key, body });
}

async function until(holds: () => boolean, waited = 0): Promise<boolean> {
  if (holds() || waited >= 5000) {
    return holds();
  }
  await setTimeout(10);
  return until(holds, waited + 10);
}

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const aTestId: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/u);

const aNumber: unknown = expect.any(Number);

describe('test_tool_call over HTTP', () => {
  it('tests a tool its server marks read-only, answering what a run’s model would see', async () => {
    const { server, graph } = await serving();

    const tested = await testOf(server, 'search', { arguments: { query: 'acme' } });

    expect(tested).toMatchObject({
      status: 200,
      body: {
        test_id: aTestId,
        server: 'graph',
        tool: 'search',
        outcome: 'result',
        text: 'Found 2 rows for acme.',
        result_bytes: aNumber,
        duration_ms: aNumber,
      },
    });
    expect(tested.headers.get('cache-control')).toBe('no-store');
    expect(graph.received()).toMatchObject([{ tool: 'search', arguments: { query: 'acme' } }]);
  });

  it('answers a tool that cannot be tested, or a server that cannot be used, as a problem, retried only when it may help', async () => {
    const { server, graph } = await serving();

    const notTestable = await testOf(server, 'echo');
    graph.answerNextWith(503);
    const failing = await testOf(server, 'search', { arguments: { query: 'acme' } });

    expect(notTestable).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'not_testable' },
    });
    expect(notTestable.headers.get('retry-after')).toBeNull();
    expect(failing).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'mcp_server_failed', because: 'failing' },
    });
    expect(failing.headers.get('retry-after')).toBe('5');
    expect(graph.received()).toEqual([]);
  });
});

describe('who may test a tool over HTTP, and what the answer leaves out', () => {
  it('refuses a key that may only read, and a retired brain, and shows no secret of the server', async () => {
    const { server, graph } = await serving();

    const read = await testOf(server, 'search', { arguments: { query: 'acme' } }, reader.key);
    const tested = await testOf(server, 'search', { arguments: { query: 'acme' } });
    await server.call('POST', `${alpha}/retire`, { key: builder.key });
    const retired = await testOf(server, 'search', { arguments: { query: 'acme' } });
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    const text = JSON.stringify([tested.body, events.body]);

    expect(read).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(retired).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'retired' } });
    expect(graph.received()).toHaveLength(1);
    expect([apiKey, 'production-eu', 'Bearer', graph.url].filter((secret) => text.includes(secret))).toEqual([]);
  });
});

describe('what a test records in the history of the brain', () => {
  it('shows a start and an answer in the events of the brain, by type, and in the history of no run', async () => {
    const { server } = await serving();

    await testOf(server, 'search', { arguments: { query: 'acme' } });
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    const starts = await server.call('GET', `${alpha}/events?type=tool_test_started`, { key: builder.key });
    const answers = await server.call('GET', `${alpha}/events?type=tool_test_answered`, { key: builder.key });
    const runs = await server.call('GET', `${alpha}/runs`, { key: builder.key });

    expect(events.body).toMatchObject({
      events: [
        {
          type: 'tool_test_started',
          summary: 'Someone allowed to change the brain tested the search tool of graph.',
          causation_id: null,
          data: { server: 'graph', tool: 'search', by: 'acme-builder' },
        },
        { type: 'tool_test_answered', summary: 'The tested tool answered.', data: { outcome: 'result' } },
      ],
    });
    expect([starts.body, answers.body]).toMatchObject([
      { events: [{ type: 'tool_test_started' }] },
      { events: [{ type: 'tool_test_answered' }] },
    ]);
    expect(runs.body).toMatchObject({ runs: [] });
  });
});

describe('what a test does not record', () => {
  it('is in the history of no run, which shows only what the run recorded', async () => {
    const { server } = await serving();
    const echo = ['---', 'language: jq', '---', '.'].join('\n');
    await server.call('POST', `${alpha}/definitions/computation`, {
      key: builder.key,
      body: { name: 'echo', source: echo },
    });

    const ran = await server.call('POST', `${alpha}/definitions/computation/echo/run`, {
      key: builder.key,
      body: { input: { said: 'hello' } },
    });
    await testOf(server, 'search', { arguments: { query: 'acme' } });
    const history = await server.call('GET', `${alpha}/runs/${decodeRun(ran.body).run_id}/history`, {
      key: builder.key,
    });

    expect(decodeEvents(history.body).events.map(({ type }) => type)).toEqual(['run_started', 'run_succeeded']);
  });

  it('is refused as the type of an event published to the brain', async () => {
    const { server } = await serving();
    const event = { id: 'e-1', source: '/acme', type: 'tool_test_started', specversion: '1.0' };

    expect(await server.call('POST', `${alpha}/events`, { key: builder.key, body: { event } })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/event/type' }] },
    });
  });
});

describe('a test whose caller goes away over HTTP while the tool is called', () => {
  it('records a start and no answer, sends no second call, and still lets the session go', async () => {
    const { server, graph } = await serving();
    const leaving = new AbortController();

    const gone: Promise<unknown> = fetch(`${server.origin}${alpha}/tool-servers/graph/tools/sleep/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${builder.key}` },
      body: JSON.stringify({ arguments: { ms: 5000 } }),
      signal: leaving.signal,
    }).catch((error: unknown) => error);
    await until(() => graph.received().length === 1);
    leaving.abort();

    expect(await gone).toMatchObject({ name: 'AbortError' });
    expect(await until(() => graph.endedSessions() === 1)).toBe(true);
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    expect(events.body).toMatchObject({ events: [{ type: 'tool_test_started' }] });
    expect(graph.received()).toHaveLength(1);
  });
});
