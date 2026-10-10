import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughChat, chatDelivery, type InteractionHarness } from '../testing/index.ts';

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const aDigest = 'd'.repeat(64);

const anyText: unknown = expect.any(String);

const aMoment: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

async function deliveryFacts(brain: InteractionHarness): Promise<readonly unknown[]> {
  const { records } = await Effect.runPromise(
    brain.ledger.service.readRecorded(
      address,
      { kind: 'run', run: askedRunId },
      {
        order: 'asc',
        limit: 20,
        types: ['delivery_started', 'delivery_succeeded', 'delivery_failed', 'delivery_refused'],
      },
    ),
  );
  return records.map(({ type, data }) => ({ type, data }));
}

function replacingText(lines: readonly string[], line: string, replacement: string): readonly string[] {
  return lines.map((each) => (each === line ? replacement : each));
}

const delivering = replacingText(
  chatDelivery,
  "    text: '{{ message }}'",
  "    text: '{{ message }}'\n    at: '{{ now }}'",
);

describe('a request delivered through a tool', () => {
  it('is one recorded call, its start before it is sent and its end with what the tool answered', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();

    await brain.performDue(askedAt);

    expect(tools.calls()).toMatchObject([
      {
        org: 'acme',
        brain: 'alpha',
        reference: { server: 'chat', tool: 'post_message' },
        input: { channel: '#approvals-ada', text: 'Please review the brief for Spring.' },
        meta: { 'com.beonauto/run_id': askedRunId, 'com.beonauto/delivery_id': anyText },
      },
    ]);
    expect(await deliveryFacts(brain)).toMatchObject([
      {
        type: 'delivery_started',
        data: {
          number: 1,
          target: 'ada',
          server: 'chat',
          tool: 'post_message',
          arguments_bytes: 73,
          arguments_sha256: aDigest,
          content_kept: true,
        },
      },
      { type: 'delivery_succeeded', data: { number: 1, result_sha256: aDigest, content_kept: true, jsonrpc_id: 1 } },
    ]);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'delivered' });
    expect(tools.posted()).toMatchObject([{ channel: '#approvals-ada', text: 'Please review the brief for Spring.' }]);
  });
});

describe('the arguments of a delivery', () => {
  it('pass an address that is not the party as any argument, a thread from the input say', async () => {
    const threaded = replacingText(
      chatDelivery,
      "    text: '{{ message }}'",
      "    text: '{{ message }}'\n    thread_ts: '{{ input.campaign }}'",
    );
    const { brain, tools, askedAt } = await askedThroughChat({ delivery: threaded });

    await brain.performDue(askedAt);

    expect(tools.posted()).toMatchObject([{ channel: '#approvals-ada', thread_ts: 'Spring' }]);
  });

  it('are the same on every attempt, its moments being those of the request', async () => {
    const { brain, tools, askedAt } = await askedThroughChat({ delivery: delivering });
    tools.answerNext({
      outcome: 'timed_out',
      detail: 'The MCP server did not answer within 30000 ms',
      retryAfterMs: null,
    });

    await brain.performDue(askedAt);
    await brain.performDue(Date.now() + 61_000);
    const [first, second] = tools.calls();

    expect(second?.input).toEqual(first?.input);
    expect(first?.input).toMatchObject({ at: aMoment });
  });
});

describe('an attempt that fails', () => {
  it('records the failure in words, the wait a server asked for, and the call it made', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext({ outcome: 'server_failure', detail: 'The MCP server answered HTTP 429', retryAfterMs: 120_000 });

    await brain.performDue(askedAt);

    expect(await deliveryFacts(brain)).toMatchObject([
      { type: 'delivery_started' },
      {
        type: 'delivery_failed',
        data: {
          because: 'server_failure',
          retry_after_ms: 120_000,
          detail: 'The MCP server answered HTTP 429',
          jsonrpc_id: 1,
        },
      },
    ]);
  });
});

describe('an attempt whose call did not answer as asked', () => {
  it('records an interrupted call as lost, and a tool the server no longer lists as a tool error', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext(
      { outcome: 'cancelled', detail: '', retryAfterMs: null },
      { outcome: 'tool_error', detail: 'Tool post_message not found', retryAfterMs: null },
    );

    await brain.performEach([askedAt, askedAt + 61_000]);
    const [, lost, , missing] = await deliveryFacts(brain);

    expect([lost, missing]).toMatchObject([
      { type: 'delivery_failed', data: { because: 'lost' } },
      {
        type: 'delivery_failed',
        data: { because: 'tool_error', detail: 'Tool post_message not found', result_bytes: 0 },
      },
    ]);
    expect(lost).not.toHaveProperty('data.detail');
  });

  it('ends with no field of an answer when no call was sent, for a tool no longer offered or a server not reached', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext({ kind: 'not_offered' }, { kind: 'unopened', detail: 'The MCP server could not be reached' });

    await brain.performEach([askedAt, askedAt + 61_000]);
    const [started, notOffered, , unopened] = await deliveryFacts(brain);

    expect([started, notOffered, unopened]).toMatchObject([
      {
        type: 'delivery_started',
        data: { number: 1, server: 'chat', tool: 'post_message', arguments_sha256: aDigest },
      },
      {
        type: 'delivery_failed',
        data: { because: 'tool_not_offered', detail: 'The operator of this server does not allow chat/post_message' },
      },
      {
        type: 'delivery_failed',
        data: { because: 'server_failure', detail: 'The MCP server could not be reached' },
      },
    ]);
    expect(notOffered).not.toHaveProperty('data.result_bytes');
    expect(unopened).not.toHaveProperty('data.result_bytes');
    expect(tools.calls()).toEqual([]);
  });
});
