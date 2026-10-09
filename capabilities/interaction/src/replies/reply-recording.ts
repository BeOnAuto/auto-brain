import { Result } from 'effect';

import type { ReadingRoute } from '../conversations/conversation-parts.ts';
import type { ConversationRow } from '../conversations/conversation-rows.ts';
import { renderedArguments } from '../route/rendered-arguments.ts';
import type { KeptRequest } from './reply-taking.ts';

export interface ReadingState {
  readonly taken: number;
  readonly refused: number;
  readonly foundAnswerer: boolean;
  readonly answered: ReadonlySet<string>;
  readonly told: ReadonlyMap<string, number>;
}

export const nothingRead: ReadingState = {
  taken: 0,
  refused: 0,
  foundAnswerer: false,
  answered: new Set(),
  told: new Map(),
};

export const replyBoundsOfAReading = { told: 3, issues: 16 } as const;

export function tellingInput({ replies }: ReadingRoute, request: KeptRequest, message: string) {
  const variables = { to: request.row.party, sent: { ...request.sent }, message };
  const rendered = replies.tell === undefined ? undefined : renderedArguments(replies.tell.with, variables);
  return rendered !== undefined && Result.isSuccess(rendered) ? rendered.success.input : undefined;
}

export function mayTell(state: ReadingState, request: KeptRequest): boolean {
  return request.row.refusals_told + (state.told.get(request.runId) ?? 0) < replyBoundsOfAReading.told;
}

export function readArguments({ replies }: ReadingRoute, row: ConversationRow, oldest: KeptRequest) {
  return renderedArguments(replies.with, {
    to: oldest.row.party,
    sent: { ...oldest.sent },
    conversation: row.conversation,
    since: row.since ?? '',
  });
}
