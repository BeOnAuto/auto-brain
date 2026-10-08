import type { ProjectedMessage, ProjectedRow, KeyedProjection } from '@beonauto/operations';
import { executionEventOf, type ExecutionEvent } from '@beonauto/specs';

import { interactionPrimitive } from '../primitive/primitive-name.ts';
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

type Fact<Type extends ExecutionEvent['type']> = Extract<ExecutionEvent, { readonly type: Type }>;

function rowOf(row: UndueRequestRow): ProjectedRow {
  return { ...row, attempt_due_at: attemptDueAtOf(row), ending_due_at: endingDueAtOf(row) };
}

function requested(fact: Fact<'execution_deferred'>, message: ProjectedMessage): ProjectedRow | undefined {
  const request = fact.primitive === interactionPrimitive ? requestRecordOf(fact.record) : undefined;
  if (request === undefined) {
    return undefined;
  }
  const at = Date.parse(fact.at);
  const { deliver, replies } = request;
  const inInbox = deliver === undefined;
  return rowOf({
    request_id: message.id,
    function: fact.name,
    version: fact.spec_version,
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
  });
}

function standingUnlessCancelling(row: OpenRequestRow, standing: OpenRequestRow['standing']) {
  return row.standing === 'cancelling' ? row.standing : standing;
}

function attemptStarted(row: OpenRequestRow, fact: Fact<'delivery_started'>): ProjectedRow {
  return rowOf({
    ...row,
    attempts: fact.number,
    next_attempt_at: Date.parse(fact.at) + attemptInFlightMs,
    standing: standingUnlessCancelling(row, 'delivering'),
  });
}

function afterFailure(row: OpenRequestRow, fact: Fact<'delivery_ended'>, at: number): UndueRequestRow {
  const next =
    fact.outcome === 'failed' && fact.number < attemptSchedule.attempts
      ? nextAttemptAt({ attempt: fact.number, endedAt: at, retryAfterMs: fact.retry_after_ms })
      : undefined;
  return next === undefined
    ? { ...row, next_attempt_at: null, standing: standingUnlessCancelling(row, 'undelivered') }
    : { ...row, next_attempt_at: next, standing: standingUnlessCancelling(row, 'retrying') };
}

function attemptEnded(row: OpenRequestRow, fact: Fact<'delivery_ended'>): ProjectedRow {
  const at = Date.parse(fact.at);
  if (fact.outcome === 'delivered') {
    return rowOf({ ...row, next_attempt_at: null, standing: standingUnlessCancelling(row, 'delivered') });
  }
  return rowOf(afterFailure(row, fact, at));
}

function endingOf(fact: Fact<'execution_succeeded' | 'execution_rejected' | 'execution_failed'>): string {
  if (fact.type === 'execution_succeeded') {
    return 'answered';
  }
  if (fact.type === 'execution_failed') {
    return 'failed';
  }
  const { rejection } = fact;
  return rejection.reason === 'unanswered' ? rejection.kind : rejection.reason;
}

function closed(
  row: OpenRequestRow,
  fact: Fact<'execution_succeeded' | 'execution_rejected' | 'execution_failed'>,
): ProjectedRow | undefined {
  return row.open ? rowOf({ ...row, open: false, next_attempt_at: null, ended: endingOf(fact) }) : undefined;
}

function worked(row: OpenRequestRow, fact: ExecutionEvent): ProjectedRow | undefined {
  if (fact.type === 'delivery_started') {
    return attemptStarted(row, fact);
  }
  if (fact.type === 'delivery_ended') {
    return attemptEnded(row, fact);
  }
  return fact.type === 'reply_taken'
    ? rowOf({ ...row, standing: standingUnlessCancelling(row, 'answered') })
    : undefined;
}

function changed(row: OpenRequestRow, fact: ExecutionEvent): ProjectedRow | undefined {
  if (fact.type === 'execution_cancel_requested') {
    return row.open && !settlesFromBroughtAnswer(row) ? rowOf({ ...row, standing: 'cancelling' }) : undefined;
  }
  return fact.type === 'execution_succeeded' || fact.type === 'execution_rejected' || fact.type === 'execution_failed'
    ? closed(row, fact)
    : worked(row, fact);
}

function rowAfter(row: ProjectedRow | undefined, event: unknown, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = executionEventOf(event);
  if (fact?.type === 'execution_deferred') {
    return requested(fact, message);
  }
  const kept = requestRowOf(row);
  return kept === undefined || fact === undefined ? undefined : changed(kept, fact);
}

export const openRequests: KeyedProjection = {
  name: openRequestsName,
  version: 4,
  kinds: ['executions'],
  types: [
    'execution_deferred',
    'delivery_started',
    'delivery_ended',
    'reply_taken',
    'execution_cancel_requested',
    'execution_succeeded',
    'execution_rejected',
    'execution_failed',
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
  ],
  indexes: [
    { name: 'by_open', columns: ['open', 'requested_at'] },
    { name: 'by_party', columns: ['party', 'requested_at'] },
    { name: 'by_function', columns: ['function', 'requested_at'] },
    { name: 'attempts_due', columns: ['attempt_due_at'], acrossBrains: true, whereSet: 'attempt_due_at' },
    { name: 'endings_due', columns: ['ending_due_at'], acrossBrains: true, whereSet: 'ending_due_at' },
  ],
  rowAfter,
};
