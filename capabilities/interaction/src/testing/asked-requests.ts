import {
  declaredFact,
  defineCapability,
  outputInWords,
  type Capability,
  type RequestRecord,
} from '@beonauto/definitions';
import { RunContextSchema, factOf } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { approvalDocument, chatDelivery, notificationDocument } from './documents.ts';
import { fakeTools, type FakeTools } from './fake-tools.ts';
import { interactionHarness, type HarnessLedger, type InteractionHarness } from './interaction-harness.ts';

export const askedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export interface AskedRequest {
  readonly brain: InteractionHarness;
  readonly tools: FakeTools;
  readonly askedAt: number;
}

export interface AskingOptions {
  readonly notification?: boolean;
  readonly expires?: string;
  readonly ledger?: HarnessLedger;
  readonly delivery?: readonly string[];
}

export async function askedThroughChat(options: AskingOptions = {}): Promise<AskedRequest> {
  const tools = fakeTools();
  const brain = interactionHarness({ tools, ledger: options.ledger });
  const expires = options.expires ?? 'P2D';
  const delivery = options.delivery ?? chatDelivery;
  await brain.define(
    'approve-brief',
    options.notification === true ? notificationDocument(delivery, expires) : approvalDocument(delivery, expires),
  );
  await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);
  return { brain, tools, askedAt: Date.now() };
}

export const nudgedRequest: RequestRecord = {
  to: 'sales',
  message: 'Confirm the forecast?',
  answer_schema: { type: 'object', required: ['confirmed'] },
  expires_at: '2099-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
  deliver: { server: 'chat', tool: 'post_message', with: { channel: '#forecast-{{ to }}', text: '{{ message }}' } },
};

const NudgeSentSchema = factOf('nudge_sent', Schema.Struct({ number: Schema.Int }), RunContextSchema);

export const nudging: Capability = defineCapability({
  type: 'nudging',
  title: 'Nudging',
  guide: { name: 'nudging' },
  noun: { one: 'nudge', other: 'nudges' },
  describeOutput: outputInWords('answer'),
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: (message) => Effect.succeed({ finishesLater: true, record: { ...nudgedRequest, message } }),
  finishesLater: true,
  facts: {
    onRuns: [declaredFact('nudge_sent', NudgeSentSchema, ({ type, data }) => ({ type, summary: 'Nudged.', data }))],
    streams: [],
  },
});
