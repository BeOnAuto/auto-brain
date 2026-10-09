import { quoted, type Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { cutAsStored } from '../bounds/text-bytes.ts';
import { answeredInWords } from '../names/tool-words.ts';
import {
  ConversationCallEventSchema,
  conversationCallsKind,
  type ConversationCallEvent,
  type ReadOutcome,
  type RepliesRead,
  type TellingEnded,
  type TellingOutcome,
  type TellingStarted,
} from './conversation-call-events.ts';

const mostNameBytes = 256;

const mostDigestBytes = 128;

const mostReadContentBytes = 1024;

const counted = new Intl.NumberFormat('en');

const decodeConversationCall = Schema.decodeUnknownSync(Schema.toCodecJson(ConversationCallEventSchema));

const failedReadWords: Readonly<Record<Exclude<ReadOutcome, 'result'>, string>> = {
  tool_error: 'the tool answered with an error',
  server_failure: 'the tool server failed',
  timed_out: `the tool server did not answer within ${counted.format(toolBounds.callMs / 1000)} seconds`,
  unreadable: 'what the tool answered could not be read as a list of replies',
  too_large: `the tool answered more than the ${counted.format(toolBounds.resultBytes)} bytes a read may take`,
  tool_not_offered: 'the tool server no longer offers the tool to this brain',
  not_sent: 'its arguments could not be rendered, so nothing was sent',
};

const tellingInWords: Readonly<Record<TellingOutcome, string>> = {
  ...answeredInWords,
  tool_not_offered: 'was no longer offered by its server',
};

function named(text: string): string {
  return cutAsStored(text, mostNameBytes);
}

function digestShown(digest: string): string {
  return cutAsStored(digest, mostDigestBytes);
}

function contentShown(name: string, content: string | undefined, mostBytes: number) {
  return content === undefined ? {} : { [name]: cutAsStored(content, mostBytes) };
}

function throughTheTool({ server, tool }: Pick<TellingStarted, 'server' | 'tool'>): string {
  return `through the tool ${named(tool)} of ${named(server)}`;
}

function argumentsShown(bytes: number | undefined, digest: string | undefined) {
  return bytes === undefined || digest === undefined
    ? {}
    : { arguments_bytes: bytes, arguments_sha256: digestShown(digest) };
}

function startShown(event: RepliesRead | TellingStarted, content: number) {
  return {
    call_id: named(event.call_id),
    by: named(event.by),
    server: named(event.server),
    tool: named(event.tool),
    ...argumentsShown(event.arguments_bytes, event.arguments_sha256),
    ...contentShown('arguments_json', event.arguments_json, content),
  };
}

function idShown(id: string | number | null): string | number | null {
  return typeof id === 'string' ? digestShown(id) : id;
}

function answerShown(event: RepliesRead | TellingEnded, content: number) {
  const { result_bytes: bytes, result_sha256: digest, duration_ms: durationMs, jsonrpc_id: jsonrpcId } = event;
  return {
    ...(bytes === undefined ? {} : { result_bytes: bytes }),
    ...(digest === undefined ? {} : { result_sha256: digest === null ? null : digestShown(digest) }),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(jsonrpcId === undefined ? {} : { jsonrpc_id: idShown(jsonrpcId) }),
    ...(event.server_request_id === undefined
      ? {}
      : { server_request_id: event.server_request_id === null ? null : named(event.server_request_id) }),
    ...contentShown('result_json', event.result_json, content),
  };
}

function readAccount(event: RepliesRead) {
  const where = `the conversation ${quoted(named(event.conversation))} ${throughTheTool(event)}`;
  const summary =
    event.outcome === 'result'
      ? `The brain looked for new replies in ${where} and found ${event.replies}, took ${event.taken} as an answer and refused ${event.refused}.`
      : `The brain could not read the replies of ${where}: ${failedReadWords[event.outcome]}.`;
  return {
    summary,
    data: {
      ...startShown(event, mostReadContentBytes),
      conversation: named(event.conversation),
      since: event.since === null ? null : named(event.since),
      outcome: event.outcome,
      ...contentShown('detail', event.detail, mostReadContentBytes),
      replies: event.replies,
      taken: event.taken,
      refused: event.refused,
      ...(event.retry_after_ms === undefined ? {} : { retry_after_ms: event.retry_after_ms }),
      ...answerShown(event, mostReadContentBytes),
    },
  };
}

function accountOf(event: ConversationCallEvent) {
  if (event.type === 'replies_read') {
    return readAccount(event);
  }
  if (event.type === 'telling_started') {
    return {
      summary: `The brain told the party how to answer ${throughTheTool(event)}.`,
      data: { ...startShown(event, toolBounds.shownContentBytes), execution_id: named(event.execution_id) },
    };
  }
  return {
    summary: `The tool that told the party ${tellingInWords[event.outcome]}.`,
    data: {
      call_id: named(event.call_id),
      by: named(event.by),
      outcome: event.outcome,
      ...answerShown(event, toolBounds.shownContentBytes),
    },
  };
}

export const conversationCallPresenter: Presenter = {
  streamKind: conversationCallsKind,
  publicNames: {
    replies_read: ['replies_read'],
    telling_started: ['telling_started'],
    telling_ended: ['telling_ended'],
  },
  present: ({ id, cursor, causationId, data }) => {
    const event = decodeConversationCall(data);
    return [{ id, cursor, causation_id: causationId, at: event.at, type: event.type, ...accountOf(event) }];
  },
};
