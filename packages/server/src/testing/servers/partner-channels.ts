import { partnerSecret } from '@beonauto/interaction/testing';
import { serveFakeReceiver, type FakeReceiver, type ReceivedRequest } from '@beonauto/outbound/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { until } from './workflow-calls.ts';

export const publicOrigin = 'https://brains.example.com';

const EventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Struct({
    execution_id: Schema.String,
    to: Schema.String,
    message: Schema.String,
    answer_url: Schema.String,
    answer_token: Schema.String,
  }),
});

export const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(EventSchema));

export async function partnerReceiver(): Promise<FakeReceiver> {
  const fake = await serveFakeReceiver();
  onTestFinished(fake.close);
  return fake;
}

export function partnerChannel(url: string, answers = false): Readonly<Record<string, string>> {
  return {
    CHANNELS: JSON.stringify({
      partner: { type: 'webhook', url, secret: '${PARTNER_WEBHOOK_SECRET}', to: '^[a-z]+$', answers, org: 'acme' },
    }),
    PARTNER_WEBHOOK_SECRET: partnerSecret,
    PUBLIC_ORIGIN: publicOrigin,
  };
}

export function receivedAtLeast(partner: FakeReceiver, count: number): Promise<readonly ReceivedRequest[]> {
  return until(
    () => Promise.resolve(partner.received()),
    (received) => received.length >= count,
  );
}
