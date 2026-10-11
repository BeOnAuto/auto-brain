import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '@beonauto/mcp';
import type { KeptContent, PresentedFact } from '@beonauto/operations';
import type { Schema } from 'effect';

import type { RunWords } from '../capability/capability.ts';
import { cutAtCodePoint, issuesShown, mostNameBytes } from '../presenting/event-data.ts';
import type {
  DeliveredAs,
  DeliveryEnded,
  DeliveryEvent,
  DeliveryStarted,
  RepliesIn,
  ReplyEvent,
} from '../runs/run-events.ts';
import { replyInWords } from './reply-words.ts';

export function deferralAccount(words: RunWords, { record }: { readonly record: Schema.JsonObject }) {
  const account = words.deferral(record);
  return account === undefined
    ? undefined
    : { type: words.deferralType, summary: account.summary, data: { record, ...account.data } };
}

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
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

function startedShown({ data }: DeliveryStarted, content: KeptContent): Schema.JsonObject {
  return { ...callFieldsShown(data), target: named(data.target), ...keptArgumentsOf(data, content) };
}

function endedShown(event: DeliveryEnded, content: KeptContent): Schema.JsonObject {
  if (event.type === 'delivery_succeeded') {
    const { data } = event;
    return {
      ...callFieldsShown(data),
      ...deliveredAsShown(data.delivered_as),
      ...repliesInShown(data.replies_in),
      ...keptAnswerOf(data, content),
    };
  }
  if (event.type === 'delivery_failed') {
    const { data } = event;
    return { ...callFieldsShown(data), ...keptAnswerOf(data, content) };
  }
  return callFieldsShown(event.data);
}

export function deliveryAccount(words: RunWords, event: DeliveryEvent, content: KeptContent): PresentedFact {
  const data = event.type === 'delivery_started' ? startedShown(event, content) : endedShown(event, content);
  return { type: event.type, summary: words.delivery(event), data };
}

function replyShown(event: ReplyEvent): Readonly<Record<string, Schema.Json>> {
  if (event.type === 'reply_taken') {
    return { answer: event.data.answer };
  }
  const { because, issues, told } = event.data;
  return { because, told, ...(issues === undefined ? {} : issuesShown(issues)) };
}

export function replyAccount(event: ReplyEvent): PresentedFact {
  const { server, tool, reply } = event.data;
  return {
    type: event.type,
    summary: replyInWords(event),
    data: {
      server: named(server),
      tool: named(tool),
      reply: { id: named(reply.id), sender: named(reply.sender) },
      ...replyShown(event),
    },
  };
}
