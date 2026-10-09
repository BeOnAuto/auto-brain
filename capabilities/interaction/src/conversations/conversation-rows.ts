import { runEventOf, type RepliesIn } from '@beonauto/definitions';
import {
  ConversationCallEventSchema,
  conversationCallsKind,
  type ConversationCallEvent,
  type RepliesRead,
} from '@beonauto/mcp';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '@beonauto/operations';
import { Option, Schema } from 'effect';

import { firstReadWaitMs } from './cadence.ts';
import { conversationKeyOf } from './conversation-keys.ts';

export const conversationsName = 'conversations';

const ConversationRowSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  conversation: Schema.String,
  since: Schema.NullOr(Schema.String),
  last_fact: Schema.String,
  joined_by: Schema.String,
  open: Schema.Boolean,
  active_at: Schema.Int,
  reads: Schema.Int,
  next_read_at: Schema.NullOr(Schema.Int),
  due_at: Schema.NullOr(Schema.Int),
});

export type ConversationRow = typeof ConversationRowSchema.Type;

export const conversationRowFrom: (row: ProjectedRow) => ConversationRow =
  Schema.decodeUnknownSync(ConversationRowSchema);

const decodeRow = Schema.decodeUnknownOption(ConversationRowSchema);

const decodeCall = Schema.decodeUnknownOption(Schema.toCodecJson(ConversationCallEventSchema));

export interface Cadence {
  readonly open: boolean;
  readonly active_at: number;
  readonly reads: number;
  readonly next_read_at: number | null;
}

export function advancedOf(cadence: Cadence): ProjectedRow {
  const { open, active_at: activeAt, reads, next_read_at: next } = cadence;
  return { open, active_at: activeAt, reads, next_read_at: next, due_at: open ? next : null };
}

interface Join {
  readonly kind: 'join';
  readonly place: RepliesIn;
  readonly at: number;
}

interface Read {
  readonly kind: 'read';
  readonly place: RepliesIn;
  readonly since: string | null;
}

type ConversationFact = Join | Read;

function isRepliesRead(event: ConversationCallEvent): event is RepliesRead {
  return event.type === 'replies_read';
}

function readOf({ server, tool, conversation, since }: RepliesRead): Read {
  return { kind: 'read', place: { server, tool, key: conversation }, since };
}

function factOf(event: unknown): ConversationFact | undefined {
  const fact = runEventOf(event);
  if (fact?.type === 'delivery_ended') {
    const place = fact.replies_in;
    return place === undefined ? undefined : { kind: 'join', place, at: Date.parse(fact.at) };
  }
  return Option.getOrUndefined(Option.map(Option.filter(decodeCall(event), isRepliesRead), readOf));
}

function joined(row: ConversationRow | undefined, { place, at }: Join, { id }: ProjectedMessage): ProjectedRow {
  const firstRead = at + firstReadWaitMs;
  const nextRead = Math.min(row?.next_read_at ?? firstRead, firstRead);
  return {
    server: place.server,
    tool: place.tool,
    conversation: place.key,
    since: row?.since ?? null,
    last_fact: id,
    joined_by: id,
    ...advancedOf({ open: true, active_at: at, reads: 0, next_read_at: nextRead }),
  };
}

function rowAfter(row: ProjectedRow | undefined, event: unknown, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = factOf(event);
  const kept = row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
  if (fact?.kind === 'join') {
    return joined(kept, fact, message);
  }
  return fact === undefined || kept === undefined ? undefined : { ...kept, since: fact.since, last_fact: message.id };
}

export const conversations: KeyedProjection = {
  name: conversationsName,
  version: 2,
  kinds: ['runs', conversationCallsKind],
  types: ['delivery_ended', 'replies_read'],
  columns: [
    { name: 'server', kind: 'text' },
    { name: 'tool', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'since', kind: 'text' },
    { name: 'last_fact', kind: 'text' },
    { name: 'joined_by', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'active_at', kind: 'integer' },
    { name: 'reads', kind: 'integer' },
    { name: 'next_read_at', kind: 'integer' },
    { name: 'due_at', kind: 'integer' },
  ],
  indexes: [{ name: 'due', columns: ['due_at'], acrossBrains: true, whereSet: 'due_at' }],
  keyOf: (event) => {
    const fact = factOf(event);
    return fact === undefined ? undefined : conversationKeyOf(fact.place);
  },
  advanced: { columns: ['open', 'active_at', 'reads', 'next_read_at', 'due_at'], setBy: ['delivery_ended'] },
  rowAfter,
};
