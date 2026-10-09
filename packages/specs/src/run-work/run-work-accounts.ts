import type {
  DeliveredAs,
  DeliveryEnded,
  DeliveryEvent,
  DeliveryStarted,
  ExecutionDeferred,
  RepliesIn,
  ReplyEvent,
} from '../execution/execution-events.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import {
  cutAtCodePoint,
  issuesShown,
  mostContentBytes,
  mostDetailBytes,
  mostDigestBytes,
  mostNameBytes,
} from '../presenting/event-data.ts';
import type { Account } from '../presenting/event-presenter.ts';
import type { RunWords } from '../primitive/primitive.ts';
import { replyInWords } from './reply-words.ts';

interface Fact {
  readonly execution_id: string;
  readonly by: string;
}

export interface TypedAccount extends Account {
  readonly type: string;
}

export function deferralAccount(words: RunWords, event: ExecutionDeferred, fact: Fact): TypedAccount | undefined {
  const account = words.deferral(event.record);
  return account === undefined
    ? undefined
    : {
        type: words.deferralType,
        summary: account.summary,
        data: { ...fact, record_bytes: jsonBytesOf(event.record), ...account.data },
      };
}

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
}

function digestShown(name: string, digest: string | null | undefined) {
  return digest === undefined ? {} : { [name]: digest === null ? null : cutAtCodePoint(digest, mostDigestBytes) };
}

function contentShown(name: string, content: string | undefined) {
  return content === undefined ? {} : { [name]: cutAtCodePoint(content, mostContentBytes) };
}

function startedShown(event: DeliveryStarted) {
  const { server, tool, target, arguments_bytes: bytes } = event;
  return {
    delivery: { server: named(server), tool: named(tool) },
    target: named(target),
    ...(bytes === undefined ? {} : { arguments_bytes: bytes }),
    ...digestShown('arguments_sha256', event.arguments_sha256),
    ...contentShown('arguments_json', event.arguments_json),
  };
}

function idShown(id: string | number | null | undefined) {
  if (id === undefined) {
    return {};
  }
  return { jsonrpc_id: typeof id === 'string' ? cutAtCodePoint(id, mostDigestBytes) : id };
}

function serverRequestShown(id: string | null | undefined) {
  return id === undefined ? {} : { server_request_id: id === null ? null : named(id) };
}

function deliveredAsShown(deliveredAs: DeliveredAs | undefined) {
  return deliveredAs === undefined
    ? {}
    : { delivered_as: { conversation: named(deliveredAs.conversation), id: named(deliveredAs.id) } };
}

function repliesInShown(repliesIn: RepliesIn | undefined) {
  return repliesIn === undefined
    ? {}
    : { replies_in: { server: named(repliesIn.server), tool: named(repliesIn.tool), key: named(repliesIn.key) } };
}

function endedShown(event: DeliveryEnded) {
  const { outcome, because, retry_after_ms: wait, detail, result_bytes: bytes } = event;
  return {
    outcome,
    ...(because === undefined ? {} : { because }),
    ...(wait === undefined ? {} : { retry_after_ms: wait }),
    ...(detail === undefined ? {} : { detail: cutAtCodePoint(detail, mostDetailBytes) }),
    ...(bytes === undefined ? {} : { result_bytes: bytes }),
    ...digestShown('result_sha256', event.result_sha256),
    ...contentShown('result_json', event.result_json),
    ...idShown(event.jsonrpc_id),
    ...serverRequestShown(event.server_request_id),
    duration_ms: event.duration_ms,
    ...deliveredAsShown(event.delivered_as),
    ...repliesInShown(event.replies_in),
  };
}

export function deliveryAccount(words: RunWords, event: DeliveryEvent, fact: Fact): TypedAccount {
  const shown = event.type === 'delivery_started' ? startedShown(event) : endedShown(event);
  return { type: event.type, summary: words.delivery(event), data: { ...fact, number: event.number, ...shown } };
}

function replyShown(event: ReplyEvent) {
  if (event.type === 'reply_taken') {
    return { answer_bytes: jsonBytesOf(event.answer) };
  }
  const { because, issues, told } = event;
  return { because, told, ...(issues === undefined ? {} : issuesShown(issues)) };
}

export function replyAccount(event: ReplyEvent, fact: Fact): TypedAccount {
  const { server, tool, reply } = event;
  return {
    type: event.type,
    summary: replyInWords(event),
    data: {
      ...fact,
      reading: { server: named(server), tool: named(tool) },
      reply: { id: named(reply.id), sender: named(reply.sender) },
      ...replyShown(event),
    },
  };
}
