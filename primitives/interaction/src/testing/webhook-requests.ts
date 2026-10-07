import { serveFakeReceiver, type FakeReceiver } from '@beonauto/outbound/testing';
import { afterEach } from 'vitest';

import { approvalDocument, notificationDocument } from './documents.ts';
import { interactionHarness, type InteractionHarness } from './interaction-harness.ts';
import { webhookChannels, type WebhookChannelOptions } from './webhook-channels.ts';

export const askedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const receivers: FakeReceiver[] = [];

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => receiver.close()));
});

export interface AskedRequest {
  readonly brain: InteractionHarness;
  readonly receiver: FakeReceiver;
  readonly askedAt: number;
}

export interface AskingOptions extends WebhookChannelOptions {
  readonly notification?: boolean;
  readonly expires?: string;
}

export async function askedThroughPartner(options: AskingOptions = {}): Promise<AskedRequest> {
  const receiver = await serveFakeReceiver();
  receivers.push(receiver);
  const brain = interactionHarness({ channels: webhookChannels(receiver.url, options) });
  const expires = options.expires ?? 'P2D';
  await brain.define(
    'approve-brief',
    options.notification === true ? notificationDocument('partner', expires) : approvalDocument('partner', expires),
  );
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);
  const askedAt = Date.now();
  return {
    brain,
    receiver,
    askedAt,
  };
}
