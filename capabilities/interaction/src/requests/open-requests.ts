import { runEventOf, type RunEvent } from '@beonauto/definitions';
import type { Context, ProjectedMessage, ProjectedRow, KeyedProjection, Recorded } from '@beonauto/operations';

import { interactionType } from '../capability/interaction-type.ts';
import { conversationKeyOf } from '../conversations/conversation-keys.ts';
import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { attemptSchedule, nextAttemptAt } from '../schedule/attempt-schedule.ts';
import {
  attemptDueAtOf,
  endingDueAtOf,
  requestRowOf,
  settlesFromBroughtAnswer,
  type OpenRequestRow,
  type UndueRequestRow,
} from './request-rows.ts';

export const openRequestsName = 'open_requests';

export const attemptInFlightMs = 60_000;

type Fact<Type extends RunEvent['type']> = Recorded<Extract<RunEvent, { readonly type: Type }>>;

function rowOf(row: UndueRequestRow): ProjectedRow {
  return { ...row, attempt_due_at: attemptDueAtOf(row), ending_due_at: endingDueAtOf(row) };
}

function functionOf({ definitionName, definitionVersion }: Context) {
  return { function: definitionName ?? '', version: definitionVersion ?? 1 };
}

function requested({ data, context }: Fact<'run_deferred'>, message: ProjectedMessage): ProjectedRow | undefined {
  const request = context.definitionType === interactionType ? requestRecordOf(data.record) : undefined;
  if (request === undefined) {
    return undefined;
  }
  const at = Date.parse(context.at);
  const { deliver, replies } = request;
  const inInbox = deliver === undefined;
  return rowOf({
    request_id: message.id,
    ...functionOf(context),
    party: request.to,
    delivery: inInbox ? null : JSON.stringify({ server: deliver.server, tool: deliver.tool }),
    replies: replies === undefined ? null : JSON.stringify(replies),
    message: request.message,
    answers: takesAnswer(request),
    answer_schema: request.answer_schema === undefined ? null : JSON.stringify(request.answer_schema),
    requested_at: at,
    expires_at: Date.parse(request.expires_at),
    attempts: 0,
    next_attempt_at: inInbox ? null : at,
    standing: inInbox ? 'in_inbox' : 'to_deliver',
    open: true,
    ended: null,
    conversation: null,
    sent_conversation: null,
    sent_id: null,
    answerer: request.answerer ?? null,
    reply: request.reply === undefined ? null : JSON.stringify(request.reply),
    reply_refusals: 0,
    refusals_told: 0,
  });
}

function standingUnlessCancelling(row: OpenRequestRow, standing: OpenRequestRow['standing']) {
  return row.standing === 'cancelling' ? row.standing : standing;
}

function attemptStarted(row: OpenRequestRow, { data, context }: Fact<'delivery_started'>): ProjectedRow {
  return rowOf({
    ...row,
    attempts: data.number,
    next_attempt_at: Date.parse(context.at) + attemptInFlightMs,
    standing: standingUnlessCancelling(row, 'delivering'),
  });
}

function nextAfter({ type, data, context }: Fact<'delivery_failed' | 'delivery_refused'>): number | undefined {
  return type === 'delivery_failed' && data.number < attemptSchedule.attempts
    ? nextAttemptAt({ attempt: data.number, endedAt: Date.parse(context.at), retryAfterMs: data.retry_after_ms })
    : undefined;
}

function afterFailure(row: OpenRequestRow, fact: Fact<'delivery_failed' | 'delivery_refused'>): UndueRequestRow {
  const next = nextAfter(fact);
  return next === undefined
    ? { ...row, next_attempt_at: null, standing: standingUnlessCancelling(row, 'undelivered') }
    : { ...row, next_attempt_at: next, standing: standingUnlessCancelling(row, 'retrying') };
}

function keptConversation({ data }: Fact<'delivery_succeeded'>) {
  const { delivered_as: deliveredAs, replies_in: repliesIn } = data;
  return {
    ...(deliveredAs === undefined ? {} : { sent_conversation: deliveredAs.conversation, sent_id: deliveredAs.id }),
    ...(repliesIn === undefined ? {} : { conversation: conversationKeyOf(repliesIn) }),
  };
}

function attemptEnded(
  row: OpenRequestRow,
  fact: Fact<'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'>,
): ProjectedRow {
  if (fact.type === 'delivery_succeeded') {
    return rowOf({
      ...row,
      ...keptConversation(fact),
      next_attempt_at: null,
      standing: standingUnlessCancelling(row, 'delivered'),
    });
  }
  return rowOf(afterFailure(row, fact));
}

function endingOf(fact: Fact<'run_succeeded' | 'run_rejected' | 'run_failed'>): string {
  if (fact.type === 'run_succeeded') {
    return 'answered';
  }
  if (fact.type === 'run_failed') {
    return 'failed';
  }
  const { rejection } = fact.data;
  return rejection.reason === 'unanswered' ? rejection.kind : rejection.reason;
}

function closed(
  row: OpenRequestRow,
  fact: Fact<'run_succeeded' | 'run_rejected' | 'run_failed'>,
): ProjectedRow | undefined {
  return row.open ? rowOf({ ...row, open: false, next_attempt_at: null, ended: endingOf(fact) }) : undefined;
}

function worked(row: OpenRequestRow, fact: Recorded<RunEvent>): ProjectedRow | undefined {
  if (fact.type === 'delivery_started') {
    return attemptStarted(row, fact);
  }
  if (fact.type === 'delivery_succeeded' || fact.type === 'delivery_failed' || fact.type === 'delivery_refused') {
    return attemptEnded(row, fact);
  }
  if (fact.type === 'reply_refused') {
    return rowOf({
      ...row,
      reply_refusals: row.reply_refusals + 1,
      refusals_told: row.refusals_told + (fact.data.told ? 1 : 0),
    });
  }
  return fact.type === 'reply_taken'
    ? rowOf({ ...row, standing: standingUnlessCancelling(row, 'answered') })
    : undefined;
}

function changed(row: OpenRequestRow, fact: Recorded<RunEvent>): ProjectedRow | undefined {
  if (fact.type === 'run_cancel_requested') {
    return row.open && !settlesFromBroughtAnswer(row) ? rowOf({ ...row, standing: 'cancelling' }) : undefined;
  }
  return fact.type === 'run_succeeded' || fact.type === 'run_rejected' || fact.type === 'run_failed'
    ? closed(row, fact)
    : worked(row, fact);
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = runEventOf(message);
  if (fact?.type === 'run_deferred') {
    return requested(fact, message);
  }
  const kept = requestRowOf(row);
  return kept === undefined || fact === undefined ? undefined : changed(kept, fact);
}

export const openRequests: KeyedProjection = {
  name: openRequestsName,
  version: 6,
  kinds: ['runs'],
  types: [
    'run_deferred',
    'delivery_started',
    'delivery_succeeded',
    'delivery_failed',
    'delivery_refused',
    'reply_taken',
    'reply_refused',
    'run_cancel_requested',
    'run_succeeded',
    'run_rejected',
    'run_failed',
  ],
  columns: [
    { name: 'request_id', kind: 'text' },
    { name: 'function', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'party', kind: 'text' },
    { name: 'delivery', kind: 'text' },
    { name: 'replies', kind: 'text' },
    { name: 'message', kind: 'text' },
    { name: 'answers', kind: 'boolean' },
    { name: 'answer_schema', kind: 'text' },
    { name: 'requested_at', kind: 'integer' },
    { name: 'expires_at', kind: 'integer' },
    { name: 'attempts', kind: 'integer' },
    { name: 'next_attempt_at', kind: 'integer' },
    { name: 'standing', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'attempt_due_at', kind: 'integer' },
    { name: 'ending_due_at', kind: 'integer' },
    { name: 'ended', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'sent_conversation', kind: 'text' },
    { name: 'sent_id', kind: 'text' },
    { name: 'answerer', kind: 'text' },
    { name: 'reply', kind: 'text' },
    { name: 'reply_refusals', kind: 'integer' },
    { name: 'refusals_told', kind: 'integer' },
  ],
  indexes: [
    { name: 'by_open', columns: ['open', 'requested_at'] },
    { name: 'by_party', columns: ['party', 'requested_at'] },
    { name: 'by_function', columns: ['function', 'requested_at'] },
    { name: 'by_conversation', columns: ['open', 'conversation', 'requested_at'] },
    { name: 'attempts_due', columns: ['attempt_due_at'], acrossBrains: true, whereSet: 'attempt_due_at' },
    { name: 'endings_due', columns: ['ending_due_at'], acrossBrains: true, whereSet: 'ending_due_at' },
  ],
  rowAfter,
};
