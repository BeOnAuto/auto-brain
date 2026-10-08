import type { DeliveryCall, DeliveryCallEnded } from '@beonauto/mcp';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChannelSettings } from '../channels/channel-settings.ts';
import { readChannelSettings } from '../channels/channels-reading.ts';
import {
  approvalDocument,
  askedRunId,
  interactionHarness,
  notificationDocument,
  partnerSecret,
} from '../testing/index.ts';

function mcpChannels(written: Readonly<Record<string, string>>): ChannelSettings {
  return Effect.runSync(
    readChannelSettings(
      {
        CHANNELS: JSON.stringify({
          approvals: { type: 'mcp', server: 'slack', tool: 'post_message', to: '^[a-z]+$', with: written, org: 'acme' },
        }),
      },
      { servers: [{ name: 'slack', org: 'acme', brains: null }], allowed: null },
    ),
  );
}

const channelArguments = {
  channel: '#approvals-{{ to }}',
  text: '{{ message }}',
  run: '{{ run_id }}',
  definition: '{{ function }}',
  until: '{{ expires_at }}',
  schema: '{{ answer_schema | json }}',
};

const manyArguments = Object.fromEntries(
  Array.from({ length: 100 }, (_, index) => [`a${index}`, '{{ answer_schema | json }}']),
);

const anyText: unknown = expect.any(String);

const choiceSchema: unknown = expect.stringContaining('"choice"');

const tooLarge: unknown = expect.stringContaining('more than the 16384 a call may send');

interface Tools {
  readonly calls: () => readonly DeliveryCall[];
  readonly callOnce: (call: DeliveryCall) => Effect.Effect<DeliveryCallEnded>;
}

function toolsAnswering(...answers: readonly DeliveryCallEnded[]): Tools {
  const calls: DeliveryCall[] = [];
  const queued = [...answers];
  return {
    calls: () => calls,
    callOnce: (call) =>
      Effect.sync(() => {
        calls.push(call);
        return queued.shift() ?? { outcome: 'result', text: '{}', bytes: 2 };
      }),
  };
}

async function askedThroughSlack(tools: Tools, written: Readonly<Record<string, string>> = channelArguments) {
  const brain = interactionHarness({ channels: mcpChannels(written), tools });
  await brain.define('approve-brief', approvalDocument('approvals'));
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);
  return { brain, askedAt: Date.now() };
}

describe('a request delivered by a tool', () => {
  it('calls the tool once with the arguments the channel renders, naming the run and the request', async () => {
    const tools = toolsAnswering();
    const { brain, askedAt } = await askedThroughSlack(tools);

    await brain.performDue(askedAt);

    expect(tools.calls()).toMatchObject([
      {
        org: 'acme',
        brain: 'alpha',
        executionId: askedRunId,
        deliveryId: anyText,
        reference: { server: 'slack', tool: 'post_message' },
        input: {
          channel: '#approvals-ada',
          text: 'Please review the brief for Spring.',
          run: askedRunId,
          definition: 'approve-brief',
          until: anyText,
          schema: choiceSchema,
        },
      },
    ]);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'delivered' });
  });

  it.each([
    ['a tool error', { outcome: 'tool_error', detail: 'Denied by the gateway', retryAfterMs: null }],
    ['a server failure', { outcome: 'server_failure', detail: 'The MCP server answered HTTP 429', retryAfterMs: 1000 }],
    ['a time out', { outcome: 'timed_out', detail: 'The MCP server did not answer in time', retryAfterMs: null }],
    ['a cancelled call', { outcome: 'cancelled', detail: '', retryAfterMs: null }],
    ['a tool not offered', { outcome: 'not_offered', detail: 'No MCP server named slack', retryAfterMs: null }],
  ] as const)('fails the attempt on %s, and tries again on the schedule', async (_case, ended) => {
    const tools = toolsAnswering(ended);
    const { brain, askedAt } = await askedThroughSlack(tools);

    await brain.performDue(askedAt);
    await brain.performDue(Date.now() + 61_000);

    expect(tools.calls()).toHaveLength(2);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });
});

const partnerKey = 'partner-api-key-7f3a9c';

function channelsHoldingSecrets(): ChannelSettings {
  const partner = {
    type: 'webhook',
    url: 'https://partner.example.com/brain/requests',
    headers: { Authorization: 'Bearer ${PARTNER_API_KEY}' },
    secret: '${PARTNER_WEBHOOK_SECRET}',
    to: '^[a-z]+$',
    org: 'acme',
  };
  const approvals = {
    type: 'mcp',
    server: 'slack',
    tool: 'post_message',
    to: '^[a-z]+$',
    with: channelArguments,
    org: 'acme',
  };
  return Effect.runSync(
    readChannelSettings(
      {
        CHANNELS: JSON.stringify({ approvals, partner }),
        PARTNER_API_KEY: partnerKey,
        PARTNER_WEBHOOK_SECRET: partnerSecret,
      },
      { servers: [{ name: 'slack', org: 'acme', brains: null }], allowed: null },
    ),
  );
}

describe('the detail of an attempt that echoes a secret of a channel', () => {
  it('is recorded with the secret scrubbed, as an MCP server scrubs its own', async () => {
    const tools = toolsAnswering({
      outcome: 'tool_error',
      detail: `The gateway refused the header Bearer ${partnerKey}`,
      retryAfterMs: null,
    });
    const brain = interactionHarness({ channels: channelsHoldingSecrets(), tools });
    await brain.define('approve-brief', approvalDocument('approvals'));
    await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);

    await brain.performDue(Date.now());
    const { records } = await Effect.runPromise(
      brain.ledger.service.readRecorded(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: askedRunId },
        { order: 'asc', limit: 10, types: ['delivery_ended'] },
      ),
    );

    expect(records.map(({ data }) => data)).toMatchObject([
      { detail: 'The gateway refused the header Bearer [redacted]' },
    ]);
  });
});

describe('arguments that grew past what a call may send', () => {
  it('refuse the attempt without calling the tool, when the channel renders more since the run started', async () => {
    const tools = toolsAnswering();
    const { brain, askedAt } = await askedThroughSlack(tools, { text: '{{ message }}' });
    const grown = brain.dueWith(mcpChannels(manyArguments));

    await brain.performAll(await brain.dueItems(askedAt, grown), askedAt);

    expect(tools.calls()).toEqual([]);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'undelivered' });
  });

  it('end the run as unworkable at its start when they take more than 16 KiB, or render no text', async () => {
    const tools = toolsAnswering();
    const brain = interactionHarness({ channels: mcpChannels(manyArguments), tools });
    const listing = interactionHarness({ channels: mcpChannels({ a: '{{ answer_schema.required }}' }), tools });
    const unlisted = interactionHarness({ channels: mcpChannels({ a: '{{ answer_schema.missing }}' }), tools });
    await Promise.all(
      [brain, listing, unlisted].map((each) => each.define('approve-brief', approvalDocument('approvals'))),
    );

    expect([
      await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId),
      await listing.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId),
      await unlisted.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId),
    ]).toMatchObject([
      {
        reason: 'conflict',
        kind: 'unworkable',
        detail: tooLarge,
      },
      {
        reason: 'conflict',
        detail: 'The argument a of the channel “approvals” renders a value that is not text for this request',
      },
      {
        reason: 'conflict',
        detail: 'The argument a of the channel “approvals” reads what this request does not have',
      },
    ]);
  });
});

describe('a notification delivered by a tool', () => {
  it('succeeds once the tool answers, and fails each attempt as not offered on a server without tool access', async () => {
    const tools = toolsAnswering();
    const delivered = interactionHarness({ channels: mcpChannels({ text: '{{ message }}' }), tools });
    const unserved = interactionHarness({ channels: mcpChannels({ text: '{{ message }}' }) });
    await Promise.all(
      [delivered, unserved].map(async (brain) => {
        await brain.define('tell', notificationDocument('approvals'));
        await brain.ask('tell', { campaign: 'Spring', owner: 'ada' }, askedRunId);
        await brain.performDue(Date.now());
      }),
    );

    expect([await delivered.runOf(askedRunId), await unserved.firstOpen()]).toMatchObject([
      { output: { status: 'succeeded', output: {} } },
      { attempts: 1, standing: 'retrying' },
    ]);
  });

  it('keeps at most 1 KiB of what a tool said when it failed', async () => {
    const tools = toolsAnswering({ outcome: 'tool_error', detail: 'x'.repeat(3000), retryAfterMs: null });
    const { brain, askedAt } = await askedThroughSlack(tools);

    await brain.performDue(askedAt);
    const { records } = await Effect.runPromise(
      brain.ledger.service.readRecorded(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: askedRunId },
        { order: 'desc', limit: 1 },
      ),
    );

    expect(records[0]?.data).toMatchObject({ type: 'delivery_ended', because: 'tool_error', detail: 'x'.repeat(1024) });
  });
});
