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
