import { memoryLedger } from '@beonauto/operations/testing';
import { Effect } from 'effect';

import { conversations, conversationsName } from '../conversations/conversation-rows.ts';
import { conversationsDue } from '../conversations/conversations-due.ts';
import { openRequests } from '../requests/open-requests.ts';
import type { RequestsDue } from '../schedule/due-requests.ts';
import { threadDocument } from './documents.ts';
import { fakeTools, type FakeTools } from './fake-tools.ts';
import { dueInBothLanes, performedAll } from './harness-parts.ts';
import { alpha, interactionHarness, type HarnessLedger, type InteractionHarness } from './interaction-harness.ts';

export interface ChatHarness extends InteractionHarness {
  readonly chat: FakeTools;
  readonly reads: RequestsDue;
  readonly performReads: (now: number) => Promise<number>;
  readonly askInThread: (runId: string, owner?: string, team?: string) => Promise<void>;
}

export interface ChatHarnessOptions {
  readonly ledger?: HarnessLedger;
  readonly document?: string;
}

export const answererId = 'U024BE7LH';

export const farAhead = 3_600_000;

export async function chatHarness(options: ChatHarnessOptions = {}): Promise<ChatHarness> {
  const chat = fakeTools();
  const ledger = options.ledger ?? memoryLedger(undefined, [openRequests, conversations]);
  const brain = interactionHarness({ ledger, tools: chat });
  const reads = conversationsDue({ ledger: ledger.service, tools: chat });
  await brain.define('approve-brief', options.document ?? threadDocument());
  return {
    ...brain,
    chat,
    reads,
    performReads: async (now) => {
      const items = await dueInBothLanes(reads, now);
      await performedAll(items, now);
      return items.length;
    },
    askInThread: async (runId, owner = answererId, team = 'sales') => {
      await brain.ask('approve-brief', { team, owner, campaign: 'Spring' }, runId);
    },
  };
}

export interface Recorded {
  readonly type: string;
  readonly data: unknown;
  readonly causationId: string | null;
  readonly id: string;
}

export async function recordsOf(ledger: HarnessLedger, ...types: readonly string[]): Promise<readonly Recorded[]> {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 100, types, dataOf: types }),
  );
  return records;
}

export function conversationRows(ledger: HarnessLedger) {
  return Effect.runPromise(
    ledger.service.readProjectedRows(conversationsName, alpha, { where: [], orderBy: [], order: 'asc', limit: 50 }),
  );
}
