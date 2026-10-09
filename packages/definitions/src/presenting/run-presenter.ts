import type { Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import {
  cancelAsked,
  runBrokeDown,
  runFinished,
  runRejected,
  runStarted,
  toolAnswered,
  toolCalled,
} from '../plain-language/event-words.ts';
import { deferralAccount, deliveryAccount, replyAccount, type TypedAccount } from '../run-work/run-work-accounts.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import {
  RunEventSchema,
  type CalledBy,
  type DeliveryEvent,
  type RunCancelRequested,
  type RunDeferred,
  type RunEvent,
  type RunStarted,
  type ReplyEvent,
  type ToolCallAnswered,
  type ToolCallEvent,
  type ToolCallStarted,
} from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import {
  cutAtCodePoint,
  issuesShown,
  mostContentBytes,
  mostCallerBytes,
  mostDetailBytes,
  mostDigestBytes,
  mostNameBytes,
} from './event-data.ts';
import type { Account } from './event-presenter.ts';

type ShownRunEvent = Exclude<RunEvent, RunDeferred | DeliveryEvent | ReplyEvent>;

interface Fact {
  readonly run_id: string;
  readonly by: string;
}

function rejectionShown(rejection: RunRejection) {
  const detail = cutAtCodePoint(rejection.detail, mostDetailBytes);
  if (rejection.reason === 'invalid_input') {
    return { reason: rejection.reason, detail, ...issuesShown(rejection.issues) };
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
  const { run_id, reference, run } = calledBy;
  return { called_by: { run_id, reference: cutAtCodePoint(reference, mostNameBytes), run } };
}

function triggerShown(trigger: RunStarted['trigger']) {
  return trigger === undefined
    ? {}
    : { trigger: { kind: trigger.kind, reference: cutAtCodePoint(trigger.reference, mostNameBytes) } };
}

function cancelAskedAccount({ kind, reason }: RunCancelRequested, fact: Fact): Account {
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
      ...(event.read_only === true ? { read_only: true } : {}),
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

function accountOf(words: DefinitionWords, event: ShownRunEvent, runId: string): Account {
  const fact = { run_id: runId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'tool_call_started' || event.type === 'tool_call_answered') {
    return toolCallAccount(event, fact);
  }
  if (event.type === 'run_started') {
    const { definition_type: definitionType, name, definition_version, input, called_by: calledBy, trigger } = event;
    return {
      summary: runStarted(words, definitionType, name, trigger),
      data: {
        ...fact,
        definition_type: definitionType,
        name,
        definition_version,
        input_bytes: jsonBytesOf(input),
        ...calledByShown(calledBy),
        ...triggerShown(trigger),
      },
    };
  }
  if (event.type === 'run_cancel_requested') {
    return cancelAskedAccount(event, fact);
  }
  if (event.type === 'run_succeeded') {
    const sizes = { output_bytes: jsonBytesOf(event.output), record_bytes: jsonBytesOf(event.record) };
    return { summary: runFinished, data: { ...fact, ...sizes } };
  }
  if (event.type === 'run_rejected') {
    const { rejection, record } = event;
    const recordSize = record === undefined ? {} : { record_bytes: jsonBytesOf(record) };
    return { summary: runRejected(rejection), data: { ...fact, ...rejectionShown(rejection), ...recordSize } };
  }
  const { incident } = event;
  return { summary: runBrokeDown, data: incident === undefined ? fact : { ...fact, incident } };
}

const runStreamsKind = 'runs';

const shownNames: Readonly<Record<Exclude<RunEvent, RunDeferred>['type'], readonly [string]>> = {
  run_started: ['run_started'],
  run_succeeded: ['run_succeeded'],
  run_rejected: ['run_rejected'],
  run_failed: ['run_failed'],
  run_cancel_requested: ['run_cancel_requested'],
  tool_call_started: ['tool_call_started'],
  tool_call_answered: ['tool_call_answered'],
  delivery_started: ['delivery_started'],
  delivery_ended: ['delivery_ended'],
  reply_taken: ['reply_taken'],
  reply_refused: ['reply_refused'],
};

const decodeRunEvent = Schema.decodeUnknownSync(Schema.toCodecJson(RunEventSchema));

function presentedAccount(words: DefinitionWords, event: RunEvent, runId: string): TypedAccount | undefined {
  const fact = { run_id: runId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'run_deferred') {
    return deferralAccount(words.runWordsOf(event.definition_type), event, fact);
  }
  if (event.type === 'delivery_started' || event.type === 'delivery_ended') {
    return deliveryAccount(words.runWordsOf(event.definition_type), event, fact);
  }
  if (event.type === 'reply_taken' || event.type === 'reply_refused') {
    return replyAccount(event, fact);
  }
  return { type: event.type, ...accountOf(words, event, runId) };
}

export function runPresenter(words: DefinitionWords): Presenter {
  return {
    streamKind: runStreamsKind,
    publicNames: { ...shownNames, run_deferred: words.deferralTypes },
    present: ({ id, cursor, causationId, stream, data }) => {
      const event = decodeRunEvent(data);
      const account = presentedAccount(words, event, stream.slice(runStreamsKind.length + 1));
      return account === undefined ? [] : [{ id, cursor, causation_id: causationId, at: event.at, ...account }];
    },
  };
}
