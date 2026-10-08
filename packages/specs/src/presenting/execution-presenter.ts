import type { Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import {
  ExecutionEventSchema,
  type CalledBy,
  type DeliveryEvent,
  type ExecutionCancelRequested,
  type ExecutionDeferred,
  type ExecutionEvent,
  type ExecutionStarted,
  type ToolCallAnswered,
  type ToolCallEvent,
  type ToolCallStarted,
} from '../execution/execution-events.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import {
  cancelAsked,
  runBrokeDown,
  runFinished,
  runRejected,
  runStarted,
  toolAnswered,
  toolCalled,
} from '../plain-language/event-words.ts';
import type { SpecWords } from '../plain-language/spec-words.ts';
import { deferralAccount, deliveryAccount, type TypedAccount } from '../run-work/run-work-accounts.ts';
import {
  cutAtCodePoint,
  issuesShown,
  mostCallerBytes,
  mostContentBytes,
  mostDetailBytes,
  mostDigestBytes,
  mostNameBytes,
} from './event-data.ts';
import type { Account } from './event-presenter.ts';

type ShownExecutionEvent = Exclude<ExecutionEvent, ExecutionDeferred | DeliveryEvent>;

interface Fact {
  readonly execution_id: string;
  readonly by: string;
}

function rejectionShown(rejection: ExecutionRejection) {
  const detail = cutAtCodePoint(rejection.detail, mostDetailBytes);
  if (rejection.reason === 'invalid_input') {
    return { reason: rejection.reason, detail, ...issuesShown(rejection.issues) };
  }
  if (rejection.reason === 'conflict') {
    const { reason, kind } = rejection;
    return { reason, detail, ...(kind === undefined ? {} : { kind }) };
  }
  if (rejection.reason === 'cancelled' || rejection.reason === 'unanswered') {
    const { reason, kind } = rejection;
    return { reason, detail, kind };
  }
  const { reason, kind, because } = rejection;
  return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function calledByShown(calledBy: CalledBy | undefined) {
  if (calledBy === undefined) {
    return {};
  }
  const { execution_id, reference, run } = calledBy;
  return { called_by: { execution_id, reference: cutAtCodePoint(reference, mostNameBytes), run } };
}

function triggerShown(trigger: ExecutionStarted['trigger']) {
  return trigger === undefined
    ? {}
    : { trigger: { kind: trigger.kind, reference: cutAtCodePoint(trigger.reference, mostNameBytes) } };
}

function cancelAskedAccount({ kind, reason }: ExecutionCancelRequested, fact: Fact): Account {
  return { summary: cancelAsked(kind), data: { ...fact, kind, reason: cutAtCodePoint(reason, mostDetailBytes) } };
}

function contentShown(name: string, content: string | undefined) {
  return content === undefined ? {} : { [name]: cutAtCodePoint(content, mostContentBytes) };
}

function callStartedAccount(event: ToolCallStarted, fact: Fact): Account {
  const server = cutAtCodePoint(event.server, mostNameBytes);
  const tool = cutAtCodePoint(event.tool, mostNameBytes);
  return {
    summary: toolCalled(event.number, server, tool),
    data: {
      ...fact,
      number: event.number,
      call_id: cutAtCodePoint(event.call_id, mostNameBytes),
      server,
      tool,
      arguments_bytes: event.arguments_bytes,
      arguments_sha256: cutAtCodePoint(event.arguments_sha256, mostDigestBytes),
      ...contentShown('arguments_json', event.arguments_json),
    },
  };
}

function idShown(id: string | number | null): string | number | null {
  return typeof id === 'string' ? cutAtCodePoint(id, mostDigestBytes) : id;
}

function serverRequestShown(id: string | null | undefined) {
  return id === undefined ? {} : { server_request_id: id === null ? null : cutAtCodePoint(id, mostNameBytes) };
}

function callAnsweredAccount(event: ToolCallAnswered, fact: Fact): Account {
  return {
    summary: toolAnswered(event.number, event.outcome),
    data: {
      ...fact,
      number: event.number,
      outcome: event.outcome,
      result_bytes: event.result_bytes,
      result_sha256: event.result_sha256 === null ? null : cutAtCodePoint(event.result_sha256, mostDigestBytes),
      duration_ms: event.duration_ms,
      jsonrpc_id: idShown(event.jsonrpc_id),
      ...serverRequestShown(event.server_request_id),
      ...contentShown('result_json', event.result_json),
    },
  };
}

function toolCallAccount(event: ToolCallEvent, fact: Fact): Account {
  return event.type === 'tool_call_started' ? callStartedAccount(event, fact) : callAnsweredAccount(event, fact);
}

function accountOf(words: SpecWords, event: ShownExecutionEvent, executionId: string): Account {
  const fact = { execution_id: executionId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'tool_call_started' || event.type === 'tool_call_answered') {
    return toolCallAccount(event, fact);
  }
  if (event.type === 'execution_started') {
    const { primitive, name, spec_version, input, called_by: calledBy, trigger } = event;
    return {
      summary: runStarted(words, primitive, name, trigger),
      data: {
        ...fact,
        primitive,
        name,
        spec_version,
        input_bytes: jsonBytesOf(input),
        ...calledByShown(calledBy),
        ...triggerShown(trigger),
      },
    };
  }
  if (event.type === 'execution_cancel_requested') {
    return cancelAskedAccount(event, fact);
  }
  if (event.type === 'execution_succeeded') {
    const sizes = { output_bytes: jsonBytesOf(event.output), record_bytes: jsonBytesOf(event.record) };
    return { summary: runFinished, data: { ...fact, ...sizes } };
  }
  if (event.type === 'execution_rejected') {
    const { rejection, record } = event;
    const recordSize = record === undefined ? {} : { record_bytes: jsonBytesOf(record) };
    return { summary: runRejected(rejection), data: { ...fact, ...rejectionShown(rejection), ...recordSize } };
  }
  const { incident } = event;
  return { summary: runBrokeDown, data: incident === undefined ? fact : { ...fact, incident } };
}

const executionsKind = 'executions';

const shownNames: Readonly<Record<Exclude<ExecutionEvent, ExecutionDeferred>['type'], readonly [string]>> = {
  execution_started: ['execution_started'],
  execution_succeeded: ['execution_succeeded'],
  execution_rejected: ['execution_rejected'],
  execution_failed: ['execution_failed'],
  execution_cancel_requested: ['execution_cancel_requested'],
  tool_call_started: ['tool_call_started'],
  tool_call_answered: ['tool_call_answered'],
  delivery_started: ['delivery_started'],
  delivery_ended: ['delivery_ended'],
};

const decodeExecutionEvent = Schema.decodeUnknownSync(Schema.toCodecJson(ExecutionEventSchema));

function presentedAccount(words: SpecWords, event: ExecutionEvent, executionId: string): TypedAccount | undefined {
  const fact = { execution_id: executionId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'execution_deferred') {
    return deferralAccount(words.runWordsOf(event.primitive), event, fact);
  }
  if (event.type === 'delivery_started' || event.type === 'delivery_ended') {
    return deliveryAccount(words.runWordsOf(event.primitive), event, fact);
  }
  return { type: event.type, ...accountOf(words, event, executionId) };
}

export function executionPresenter(words: SpecWords): Presenter {
  return {
    streamKind: executionsKind,
    publicNames: { ...shownNames, execution_deferred: words.deferralTypes },
    present: ({ id, cursor, causationId, stream, data }) => {
      const event = decodeExecutionEvent(data);
      const account = presentedAccount(words, event, stream.slice(executionsKind.length + 1));
      return account === undefined ? [] : [{ id, cursor, causation_id: causationId, at: event.at, ...account }];
    },
  };
}
