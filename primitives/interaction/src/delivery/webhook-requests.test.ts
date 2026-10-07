import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { requestTokenCallerOf } from '@beonauto/operations';
import { serveFakeReceiver, type FakeReceiver } from '@beonauto/outbound/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineAnswerInteraction } from '../requests/answer-interaction.ts';
import { listInteractions } from '../requests/list-interactions.ts';
import {
  approvalDocument,
  interactionHarness,
  partnerSecret,
  webhookChannels,
  type WebhookChannelOptions,
} from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const receivers: FakeReceiver[] = [];

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => receiver.close()));
});

const EventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  source: Schema.String,
  subject: Schema.String,
  data: Schema.Struct({
    to: Schema.String,
    message: Schema.String,
    answer_token: Schema.String,
    answer_url: Schema.String,
  }),
});

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(EventSchema));

function independentlySigned(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(partnerSecret.slice('whsec_'.length), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64')}`;
}

async function askedThroughPartner(options: WebhookChannelOptions = {}) {
  const receiver = await serveFakeReceiver();
  receivers.push(receiver);
  const channels = webhookChannels(receiver.url, options);
  const brain = interactionHarness({ channels });
  await brain.define('approve-brief', approvalDocument('partner'));
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { brain, receiver, channels, answer: defineAnswerInteraction(channels) };
}

describe('a request delivered by webhook', () => {
  it('is posted as the CloudEvent interaction_requested, signed as Standard Webhooks signs, with its answer token', async () => {
    const { brain, receiver } = await askedThroughPartner();

    expect(await brain.performDue(Date.now())).toBe(1);
    const [posted] = receiver.received();
    const event = decodeEvent(posted?.body);

    expect(posted?.headers).toMatchObject({
      authorization: 'Bearer partner-api-key-7f3a9c',
      'content-type': 'application/cloudevents+json',
      'webhook-id': event.id,
    });
    expect(posted?.headers['webhook-signature']).toBe(
      independentlySigned(event.id, String(posted?.headers['webhook-timestamp']), String(posted?.body)),
    );
    expect(event).toMatchObject({
      type: 'interaction_requested',
      subject: 'interaction/approve-brief',
      source: `https://brains.example.com/v1/orgs/acme/brains/alpha/executions/${runId}`,
      data: {
        to: 'ada',
        message: 'Please review the brief for Spring.',
        answer_url: `https://brains.example.com/v1/orgs/acme/brains/alpha/executions/${runId}/answer`,
      },
    });
    expect(await brain.call(listInteractions, {})).toMatchObject({
      output: { interactions: [{ execution_id: runId, attempts: 1, standing: 'delivered' }] },
    });
  });
});

describe('the answer token of a request delivered by webhook', () => {
  it('is answered with its answer token alone, recorded as answered by the channel', async () => {
    const { brain, receiver, answer } = await askedThroughPartner();
    await brain.performDue(Date.now());
    const token = decodeEvent(receiver.received()[0]?.body).data.answer_token;

    const answered = await brain.call(
      answer,
      { execution_id: runId, answer: { choice: 'approve' } },
      requestTokenCallerOf('acme', token),
    );

    expect(answered).toMatchObject({ status: 'succeeded', output: { status: 'succeeded' } });
    expect(await brain.runOf(runId)).toMatchObject({ output: { record: { answered_by: 'channel:partner' } } });
  });

  it('refuses a token that does not answer the request as forbidden, and leaves it open', async () => {
    const { brain, answer } = await askedThroughPartner();
    await brain.performDue(Date.now());

    expect(
      await brain.call(
        answer,
        { execution_id: runId, answer: { choice: 'approve' } },
        requestTokenCallerOf('acme', 'AAAA'),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(await brain.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });
});
