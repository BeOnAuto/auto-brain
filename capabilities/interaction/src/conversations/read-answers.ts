import { Buffer } from 'node:buffer';

import {
  answerDocument,
  toolBounds,
  type CallAnswered,
  type CalledOnce,
  type ReadingFailedBecause,
} from '@beonauto/mcp';

import { isBoundedPart } from '../delivery/sent-messages.ts';
import type { Reply } from '../replies/reply-taking.ts';
import { textAt, valueAt } from '../tool-blocks/json-pointers.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';

type ReplyPointers = Replies['read']['each'];

interface ReadOf {
  readonly replies: readonly Reply[];
  readonly ids: readonly string[];
  readonly considered: number;
  readonly retryAfterMs: number | null;
}

export type ReadAnswer =
  | (ReadOf & { readonly outcome: 'result'; readonly answered: CallAnswered })
  | (ReadOf & { readonly outcome: ReadingFailedBecause });

export function failedRead(outcome: ReadingFailedBecause, retryAfterMs: number | null = null): ReadAnswer {
  return { outcome, replies: [], ids: [], considered: 0, retryAfterMs };
}

function idOf(item: unknown, each: ReplyPointers): readonly string[] {
  const id = textAt(item, each.id);
  return id !== undefined && isBoundedPart(id) ? [id] : [];
}

function replyOf(item: unknown, each: ReplyPointers): readonly Reply[] {
  const id = textAt(item, each.id);
  const sender = textAt(item, each.sender);
  if (id === undefined || sender === undefined || !isBoundedPart(id) || !isBoundedPart(sender)) {
    return [];
  }
  return [{ id, sender, text: textAt(item, each.text), to: each.to === undefined ? undefined : textAt(item, each.to) }];
}

function listed(replies: Replies, document: unknown, answered: CallAnswered): ReadAnswer {
  const list = valueAt(document, replies.read.list);
  return Array.isArray(list)
    ? {
        outcome: 'result',
        answered,
        replies: list.flatMap((item: unknown) => replyOf(item, replies.read.each)),
        ids: list.flatMap((item: unknown) => idOf(item, replies.read.each)),
        considered: list.length,
        retryAfterMs: null,
      }
    : failedRead('unreadable');
}

export function readAnswerOf(replies: Replies, called: CalledOnce): ReadAnswer {
  if (called.kind === 'unopened') {
    return failedRead(called.refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure');
  }
  if (called.outcome !== 'result') {
    return failedRead(called.outcome, called.retryAfterMs);
  }
  const document = answerDocument(called.answer);
  if (document === undefined) {
    return failedRead('unreadable');
  }
  return Buffer.byteLength(JSON.stringify(document), 'utf8') > toolBounds.readAnswerBytes
    ? failedRead('too_large')
    : listed(replies, document, called.answered);
}
