import type { ProjectedMessage, ProjectedRow, RunProjection } from '@beonauto/operations';
import { nextAttemptAt, outboundBounds } from '@beonauto/outbound';
import { executionEventOf, type ExecutionEvent } from '@beonauto/specs';

import { inboxChannel } from '../channels/channel-names.ts';
import { interactionPrimitive } from '../primitive/primitive-name.ts';
import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { dueAtOf, requestRowOf, type OpenRequestRow } from './request-rows.ts';

export const openRequestsName = 'open_requests';

export const attemptInFlightMs = 60_000;

type Fact<Type extends ExecutionEvent['type']> = Extract<ExecutionEvent, { readonly type: Type }>;

function rowOf(row: Omit<OpenRequestRow, 'due_at'>): ProjectedRow {
  return { ...row, due_at: dueAtOf(row) };
}

function requested(fact: Fact<'execution_deferred'>, message: ProjectedMessage): ProjectedRow | undefined {
  const request = fact.primitive === interactionPrimitive ? requestRecordOf(fact.record) : undefined;
  if (request === undefined) {
    return undefined;
  }
  const at = Date.parse(fact.at);
  const inInbox = request.channel === inboxChannel;
  return rowOf({
    request_id: message.id,
    function: fact.name,
    version: fact.spec_version,
    party: request.to,
    channel: request.channel,
    message: request.message,
    answers: takesAnswer(request),
    requested_at: at,
    expires_at: Date.parse(request.expires_at),
    attempts: 0,
    next_attempt_at: inInbox ? null : at,
    standing: inInbox ? 'in_inbox' : 'to_deliver',
    open: true,
    ended: null,
  });
}

function attemptStarted(row: OpenRequestRow, fact: Fact<'delivery_started'>): ProjectedRow {
  return rowOf({
    ...row,
    attempts: fact.number,
    next_attempt_at: Date.parse(fact.at) + attemptInFlightMs,
    standing: 'delivering',
  });
}

function afterFailure(row: OpenRequestRow, fact: Fact<'delivery_ended'>, at: number): Omit<OpenRequestRow, 'due_at'> {
  const next =
    fact.outcome === 'failed' && fact.number < outboundBounds.attempts
      ? nextAttemptAt({ attempt: fact.number, endedAt: at, retryAfterMs: fact.retry_after_ms })
      : undefined;
  return next === undefined
    ? { ...row, next_attempt_at: null, standing: 'undelivered' }
    : { ...row, next_attempt_at: next, standing: 'retrying' };
}

function attemptEnded(row: OpenRequestRow, fact: Fact<'delivery_ended'>): ProjectedRow {
  const at = Date.parse(fact.at);
  if (fact.outcome === 'delivered' || fact.outcome === 'answered') {
    return rowOf({ ...row, next_attempt_at: null, standing: 'delivered' });
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

function changed(row: OpenRequestRow, fact: ExecutionEvent): ProjectedRow | undefined {
  if (fact.type === 'delivery_started') {
    return attemptStarted(row, fact);
  }
  if (fact.type === 'delivery_ended') {
    return attemptEnded(row, fact);
  }
  return fact.type === 'execution_succeeded' || fact.type === 'execution_rejected' || fact.type === 'execution_failed'
    ? closed(row, fact)
    : undefined;
}

function rowAfter(row: ProjectedRow | undefined, event: unknown, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = executionEventOf(event);
  if (fact?.type === 'execution_deferred') {
    return requested(fact, message);
  }
  const kept = requestRowOf(row);
  return kept === undefined || fact === undefined ? undefined : changed(kept, fact);
}

export const openRequests: RunProjection = {
  name: openRequestsName,
  version: 1,
  types: [
    'execution_deferred',
    'delivery_started',
    'delivery_ended',
    'execution_succeeded',
    'execution_rejected',
    'execution_failed',
  ],
  columns: [
    { name: 'request_id', kind: 'text' },
    { name: 'function', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'party', kind: 'text' },
    { name: 'channel', kind: 'text' },
    { name: 'message', kind: 'text' },
    { name: 'answers', kind: 'boolean' },
    { name: 'requested_at', kind: 'integer' },
    { name: 'expires_at', kind: 'integer' },
    { name: 'attempts', kind: 'integer' },
    { name: 'next_attempt_at', kind: 'integer' },
    { name: 'standing', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'due_at', kind: 'integer' },
    { name: 'ended', kind: 'text' },
  ],
  indexes: [
    { name: 'by_open', columns: ['open', 'requested_at'] },
    { name: 'by_party', columns: ['party', 'requested_at'] },
    { name: 'by_function', columns: ['function', 'requested_at'] },
    { name: 'due', columns: ['due_at'], acrossBrains: true, whereSet: 'due_at' },
  ],
  rowAfter,
};
