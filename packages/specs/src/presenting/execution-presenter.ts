import type { Presenter } from '@beonauto/operations';

import {
  ExecutionEventSchema,
  type ExecutionEvent,
  type ToolCallAnswered,
  type ToolCallEvent,
  type ToolCallStarted,
} from '../execution/execution-events.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import {
  runBrokeDown,
  runCarriesOn,
  runFinished,
  runRejected,
  runStarted,
  toolAnswered,
  toolCalled,
} from '../plain-language/event-words.ts';
import type { SpecWords } from '../plain-language/spec-words.ts';
import {
  cutAtCodePoint,
  issuesShown,
  mostCallerBytes,
  mostContentBytes,
  mostDetailBytes,
  mostDigestBytes,
  mostNameBytes,
} from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

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
  const { reason, kind, because } = rejection;
  return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
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

function accountOf(words: SpecWords, event: ExecutionEvent, executionId: string): Account {
  const fact = { execution_id: executionId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'tool_call_started' || event.type === 'tool_call_answered') {
    return toolCallAccount(event, fact);
  }
  if (event.type === 'execution_started') {
    const { primitive, name, spec_version, input } = event;
    return {
      summary: runStarted(words, primitive, name),
      data: { ...fact, primitive, name, spec_version, input_bytes: jsonBytesOf(input) },
    };
  }
  if (event.type === 'execution_deferred') {
    return { summary: runCarriesOn, data: { ...fact, record_bytes: jsonBytesOf(event.record) } };
  }
  if (event.type === 'execution_succeeded') {
    const sizes = { output_bytes: jsonBytesOf(event.output), record_bytes: jsonBytesOf(event.record) };
    return { summary: runFinished, data: { ...fact, ...sizes } };
  }
  if (event.type === 'execution_rejected') {
    return { summary: runRejected(event.rejection), data: { ...fact, ...rejectionShown(event.rejection) } };
  }
  return { summary: runBrokeDown, data: fact };
}

export function executionPresenter(words: SpecWords): Presenter {
  return eventPresenter<ExecutionEvent['type'], ExecutionEvent>({
    streamKind: 'executions',
    eventSchema: ExecutionEventSchema,
    publicNames: {
      execution_started: ['execution_started'],
      execution_deferred: ['execution_deferred'],
      execution_succeeded: ['execution_succeeded'],
      execution_rejected: ['execution_rejected'],
      execution_failed: ['execution_failed'],
      tool_call_started: ['tool_call_started'],
      tool_call_answered: ['tool_call_answered'],
    },
    account: (event, executionId) => accountOf(words, event, executionId),
  });
}
