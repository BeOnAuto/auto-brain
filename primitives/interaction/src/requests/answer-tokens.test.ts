import { Buffer } from 'node:buffer';

import { requestTokenCallerOf } from '@beonauto/operations';
import { answerTokenOf } from '@beonauto/outbound';
import { Effect, Redacted, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChannelSettings } from '../channels/channel-settings.ts';
import { readChannelSettings } from '../channels/channels-reading.ts';
import {
  alpha,
  approvalDocument,
  interactionHarness,
  partnerSecret,
  type InteractionHarness,
} from '../testing/index.ts';
import { defineAnswerInteraction } from './answer-interaction.ts';
import { openRequestsName } from './open-requests.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherSecret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;

const rotatedSecret = `whsec_${Buffer.alloc(32, 11).toString('base64')}`;

const days = 24 * 60 * 60_000;

function webhookOf(name: string, scope: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'webhook',
    url: `https://${name}.example.com/requests`,
    secret: `\${${name.toUpperCase()}_WEBHOOK_SECRET}`,
    to: '^[a-z]+$',
    answers: true,
    org: 'acme',
    ...scope,
  };
}

const approvals = {
  type: 'mcp',
  server: 'slack',
  tool: 'post_message',
  to: '^[a-z]+$',
  with: { text: '{{ message }}' },
  org: 'acme',
};

function channelsOf(
  entries: Readonly<Record<string, unknown>>,
  secrets: Readonly<Record<string, string>> = {},
): ChannelSettings {
  return Effect.runSync(
    readChannelSettings(
      {
        CHANNELS: JSON.stringify(entries),
        PARTNER_WEBHOOK_SECRET: partnerSecret,
        OTHER_WEBHOOK_SECRET: otherSecret,
        ...secrets,
      },
      { servers: [{ name: 'slack', org: 'acme', brains: null, allowed: null }] },
    ),
  );
}

const channels = channelsOf({ partner: webhookOf('partner'), other: webhookOf('other'), approvals });

const answer = defineAnswerInteraction(channels);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Struct({ row: Schema.Struct({ request_id: Schema.String }) })]),
);

async function requestIdOf(brain: InteractionHarness): Promise<string> {
  const rows = await Effect.runPromise(
    brain.ledger.service.readProjectedRows(openRequestsName, alpha, {
      where: [{ column: 'row_key', equals: runId }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  );
  return decodeRows(rows)[0].row.request_id;
}

async function askedThrough(channel: string) {
  const brain = interactionHarness({ channels });
  await brain.define('approve-brief', approvalDocument(channel));
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { brain, requestId: await requestIdOf(brain) };
}

interface Answering {
  readonly secret: string;
  readonly requestId: string;
  readonly choice?: string;
  readonly claimedFor?: string;
  readonly through?: ChannelSettings;
}

function answeredWith(brain: InteractionHarness, { secret, requestId, choice, claimedFor, through }: Answering) {
  return brain.call(
    through === undefined ? answer : defineAnswerInteraction(through),
    {
      execution_id: runId,
      answer: { choice: choice ?? 'approve' },
      ...(claimedFor === undefined ? {} : { claimed_for: claimedFor }),
    },
    requestTokenCallerOf('acme', answerTokenOf(Redacted.make(secret), requestId)),
  );
}

const refused = { status: 'rejected', reason: 'forbidden', detail: 'The token does not answer this request' };

const stillOpen = { output: { status: 'started' } };

describe('an answer token', () => {
  it('answers a request with the token of the channel it went through, recorded as that channel', async () => {
    const { brain, requestId } = await askedThrough('partner');

    expect(await answeredWith(brain, { secret: partnerSecret, requestId })).toMatchObject({ status: 'succeeded' });
    expect(await brain.runOf(runId)).toMatchObject({ output: { record: { answered_by: 'channel:partner' } } });
  });

  it('answers no request that went through another webhook channel, though that channel serves the brain', async () => {
    const { brain, requestId } = await askedThrough('partner');

    expect(await answeredWith(brain, { secret: otherSecret, requestId })).toMatchObject(refused);
    expect(await brain.runOf(runId)).toMatchObject(stillOpen);
  });

  it('answers no request in the inbox, whatever webhook channel of the brain signed it', async () => {
    const { brain, requestId } = await askedThrough('inbox');

    expect(await answeredWith(brain, { secret: partnerSecret, requestId })).toMatchObject(refused);
    expect(await answeredWith(brain, { secret: otherSecret, requestId })).toMatchObject(refused);
    expect(await brain.runOf(runId)).toMatchObject(stillOpen);
  });

  it('answers no request sent through an MCP channel, which signs nothing', async () => {
    const { brain, requestId } = await askedThrough('approvals');

    expect(await answeredWith(brain, { secret: partnerSecret, requestId })).toMatchObject(refused);
    expect(await brain.runOf(runId)).toMatchObject(stillOpen);
  });
});

describe('an answer token whose channel changed after the delivery', () => {
  it('answers nothing once the channel is gone from the configuration, its secret rotated, or its brains narrowed', async () => {
    const { brain, requestId } = await askedThrough('partner');
    const gone = channelsOf({ other: webhookOf('other') });
    const rotated = channelsOf({ partner: webhookOf('partner') }, { PARTNER_WEBHOOK_SECRET: rotatedSecret });
    const narrowed = channelsOf({ partner: webhookOf('partner', { brains: ['beta'] }) });

    expect(
      await Promise.all(
        [gone, rotated, narrowed].map((through) => answeredWith(brain, { secret: partnerSecret, requestId, through })),
      ),
    ).toMatchObject([refused, refused, refused]);
    expect(await brain.runOf(runId)).toMatchObject(stillOpen);
  });
});

describe('an answer given with a token, given again', () => {
  it('answers the run as it stands for the same answer, and is a conflict for another', async () => {
    const { brain, requestId } = await askedThrough('partner');

    const first = await answeredWith(brain, { secret: partnerSecret, requestId, claimedFor: 'the campaign team' });
    const same = await answeredWith(brain, { secret: partnerSecret, requestId });
    const other = await answeredWith(brain, { secret: partnerSecret, requestId, choice: 'reject' });

    expect([first, same, other]).toMatchObject([
      { status: 'succeeded' },
      { status: 'succeeded' },
      { status: 'rejected', reason: 'conflict' },
    ]);
    expect(await brain.runOf(runId)).toMatchObject({
      output: { record: { answered_by: 'channel:partner', claimed_for: 'the campaign team' } },
    });
  });

  it('is a conflict once the run ended otherwise, as expired', async () => {
    const { brain, requestId } = await askedThrough('partner');
    await brain.performDue(Date.now() + 3 * days);

    expect(await answeredWith(brain, { secret: partnerSecret, requestId })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
    });
    expect(await brain.runOf(runId)).toMatchObject({ output: { status: 'rejected' } });
  });
});
