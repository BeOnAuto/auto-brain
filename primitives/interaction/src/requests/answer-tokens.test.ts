import { Buffer } from 'node:buffer';

import { requestTokenCallerOf } from '@beonauto/operations';
import { answerTokenOf } from '@beonauto/outbound';
import { Effect, Redacted, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

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

function webhookOf(name: string) {
  return {
    type: 'webhook',
    url: `https://${name}.example.com/requests`,
    secret: `\${${name.toUpperCase()}_WEBHOOK_SECRET}`,
    to: '^[a-z]+$',
    answers: true,
    org: 'acme',
  };
}

const channels = Effect.runSync(
  readChannelSettings(
    {
      CHANNELS: JSON.stringify({ partner: webhookOf('partner'), other: webhookOf('other') }),
      PARTNER_WEBHOOK_SECRET: partnerSecret,
      OTHER_WEBHOOK_SECRET: otherSecret,
    },
    { servers: [], allowed: null },
  ),
);

const answer = defineAnswerInteraction(channels);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Struct({ row: Schema.Struct({ request_id: Schema.String }) })]),
);

async function requestIdOf(brain: InteractionHarness): Promise<string> {
  const rows = await Effect.runPromise(
    brain.ledger.service.readProjectedRows(openRequestsName, alpha, {
      where: [{ column: 'run_id', equals: runId }],
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

function answeredWith(brain: InteractionHarness, secret: string, requestId: string) {
  return brain.call(
    answer,
    { execution_id: runId, answer: { choice: 'approve' } },
    requestTokenCallerOf('acme', answerTokenOf(Redacted.make(secret), requestId)),
  );
}

const refused = { status: 'rejected', reason: 'forbidden', detail: 'The token does not answer this request' };

describe('an answer token', () => {
  it('answers a request with the token of the channel it went through, recorded as that channel', async () => {
    const { brain, requestId } = await askedThrough('partner');

    expect(await answeredWith(brain, partnerSecret, requestId)).toMatchObject({ status: 'succeeded' });
    expect(await brain.runOf(runId)).toMatchObject({ output: { record: { answered_by: 'channel:partner' } } });
  });

  it('answers no request that went through another webhook channel, though that channel serves the brain', async () => {
    const { brain, requestId } = await askedThrough('partner');

    expect(await answeredWith(brain, otherSecret, requestId)).toMatchObject(refused);
    expect(await brain.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });

  it('answers no request in the inbox, whatever webhook channel of the brain signed it', async () => {
    const { brain, requestId } = await askedThrough('inbox');

    expect(await answeredWith(brain, partnerSecret, requestId)).toMatchObject(refused);
    expect(await answeredWith(brain, otherSecret, requestId)).toMatchObject(refused);
    expect(await brain.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });
});
