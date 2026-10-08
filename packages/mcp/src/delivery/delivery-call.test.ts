import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import {
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  serveFakeMcp,
  toolRun,
  type FakeMcpServer,
} from '../testing/index.ts';
import { deliveryBounds, type DeliveryCall } from './delivery-bounds.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(url: string, changes: Readonly<Record<string, unknown>> = {}, callMs = patientTiming.callMs) {
  const { access } = reportingAccess(
    { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...changes } },
    {
      environment: { GRAPH_API_KEY: apiKey },
      timing: { ...patientTiming, callMs },
      allowed: ['graph/echo', 'graph/denied', 'graph/sleep', 'graph/large', 'graph/search', 'graph/gone'],
    },
  );
  closing.push(access.close);
  return access;
}

const largeAnswer = JSON.stringify({ content: [{ type: 'text', text: '\u{1F600}'.repeat(8 * 256) }] });

const largeAnswerBytes = Buffer.byteLength(largeAnswer);

const answerOpening = '{"content":[{"type":"text","text":"';

const largeAnswerKept = `${answerOpening}${'\u{1F600}'.repeat(Math.floor((deliveryBounds.resultBytes - answerOpening.length) / 4))}`;

const toolErrorDetail: unknown = expect.stringContaining('The field salary is denied by the policy');

const toolMissingDetail: unknown = expect.stringContaining('Tool gone not found');

const delivery: DeliveryCall = {
  org: 'acme',
  brain: 'alpha',
  executionId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  deliveryId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
  reference: { server: 'graph', tool: 'echo' },
  input: { channel: '#approvals', text: 'Please approve' },
};

function calledOnce(access: ReturnType<typeof accessTo>, changes: Partial<DeliveryCall> = {}) {
  return Effect.runPromise(access.callOnce({ ...delivery, ...changes }));
}

describe('one call of a tool for a delivery', () => {
  it('calls the tool with its arguments as they are, naming the run and the delivery so a receiver can deduplicate', async () => {
    const fake = await fakeServer();
    const access = accessTo(fake.url);

    expect(await calledOnce(access)).toEqual({
      outcome: 'result',
      text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(delivery.input) }] }),
      bytes: 95,
    });
    expect(fake.received()).toEqual([
      {
        tool: 'echo',
        arguments: delivery.input,
        meta: { 'com.beonauto/execution_id': delivery.executionId, 'com.beonauto/delivery_id': delivery.deliveryId },
      },
    ]);
    expect(fake.seen().map(({ rpc }) => rpc)).not.toContain('tools/list');
  });

  it('is a tool error when the tool answers with one, or the server does not have the tool', async () => {
    const fake = await fakeServer();
    const access = accessTo(fake.url);

    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'denied' } })).toMatchObject({
      outcome: 'tool_error',
      detail: toolErrorDetail,
      retryAfterMs: null,
    });
    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'gone' } })).toMatchObject({
      outcome: 'tool_error',
      detail: toolMissingDetail,
    });
  });

  it('ends at its call bound, waiting no longer than a delivery may', async () => {
    const fake = await fakeServer();

    expect(
      await calledOnce(accessTo(fake.url, {}, 200), {
        reference: { server: 'graph', tool: 'sleep' },
        input: { ms: 5000 },
      }),
    ).toEqual({ outcome: 'timed_out', detail: 'The MCP server did not answer within 200 ms', retryAfterMs: null });
    expect(deliveryBounds).toMatchObject({ connectionMs: 10_000, callMs: 30_000 });
  });
});

describe('what a tool answers a delivery', () => {
  it('is kept to 4 KiB, cut at a character, and counted whole', async () => {
    const fake = await fakeServer();

    const answered = await calledOnce(accessTo(fake.url), {
      reference: { server: 'graph', tool: 'large' },
      input: { kib: 8 },
    });

    expect(answered).toEqual({ outcome: 'result', text: largeAnswerKept, bytes: largeAnswerBytes });
    expect(Buffer.byteLength(largeAnswerKept)).toBeLessThanOrEqual(deliveryBounds.resultBytes);
  });
});

describe('a server that cannot take a delivery now', () => {
  it('hands on the wait a 429 asks for to the schedule of the delivery, without waiting it out in the call', async () => {
    const fake = await fakeServer();
    const access = accessTo(fake.url);
    const tools = Result.getOrThrow(
      await Effect.runPromise(
        Effect.result(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }])),
      ),
    );
    closing.push(tools.close);

    fake.answerNextWith(429, 1, { 'retry-after': '120' });

    expect(await calledOnce(access)).toEqual({
      outcome: 'server_failure',
      detail: 'The MCP server answered HTTP 429',
      retryAfterMs: 120_000,
    });
  });

  it('is a server failure when the server cannot be reached', async () => {
    const fake = await fakeServer();
    const { url } = fake;
    await fake.close();

    expect(await calledOnce(accessTo(url))).toEqual({
      outcome: 'server_failure',
      detail: 'The MCP server could not be reached',
      retryAfterMs: null,
    });
  });
});

describe('the words of a server that fails a delivery', () => {
  it('are cut at 1 KiB, the bound every reader of a failure shares', async () => {
    const fake = await fakeServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: apiKey }, fetch: () => Promise.reject(new Error(refusal)) },
    );
    closing.push(access.close);

    expect(await calledOnce(access)).toEqual({
      outcome: 'server_failure',
      detail: refusal.slice(0, toolBounds.failureBytes),
      retryAfterMs: null,
    });
  });
});

describe('a delivery through a tool this brain is not offered', () => {
  it('is refused before anything is sent, for a server it does not have, of another org, or a tool not allowed', async () => {
    const fake = await fakeServer();
    const access = accessTo(fake.url);
    const elsewhere = accessTo(fake.url, { org: 'globex' });

    expect([
      await calledOnce(access, { reference: { server: 'wiki', tool: 'echo' } }),
      await calledOnce(elsewhere),
      await calledOnce(access, { reference: { server: 'graph', tool: 'environment' } }),
    ]).toEqual([
      { outcome: 'not_offered', detail: 'No MCP server named wiki is configured for this brain', retryAfterMs: null },
      { outcome: 'not_offered', detail: 'No MCP server named graph is configured for this brain', retryAfterMs: null },
      {
        outcome: 'not_offered',
        detail: 'The operator of this server does not allow graph/environment',
        retryAfterMs: null,
      },
    ]);
    expect(fake.received()).toEqual([]);
  });
});
