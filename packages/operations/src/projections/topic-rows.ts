import { Option, Result, Schema } from 'effect';

import type { Context } from '../ledger/context.ts';
import { factOf, type Decider } from '../ledger/decider.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const OpenedSchema = factOf('topic_opened', Schema.Struct({ topic: Schema.String, at: Schema.Int }));

const NotedSchema = factOf('topic_noted', Schema.Struct({ topic: Schema.String, note: Schema.String }));

const TopicFactSchema = Schema.Union([OpenedSchema, NotedSchema]);

export type TopicFact = typeof TopicFactSchema.Type;

const topicContext: Context = { at: '2026-10-05T09:00:00.000Z', by: 'topics' };

export const topicFacts: Decider<null, readonly TopicFact[], TopicFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => topicContext,
  eventSchema: TopicFactSchema,
};

const decodeFact = Schema.decodeUnknownOption(TopicFactSchema);

export const topicWaitMs = 5000;

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: TopicFact,
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  if (fact.type === 'topic_opened') {
    const nextAt = fact.data.at + topicWaitMs;
    return {
      topic: fact.data.topic,
      note: row?.['note'] ?? null,
      last_message: id,
      open: true,
      next_at: nextAt,
      due_at: nextAt,
    };
  }
  return row === undefined ? undefined : { ...row, note: fact.data.note, last_message: id };
}

export const topicRows: KeyedProjection = {
  name: 'topics',
  version: 2,
  kinds: ['runs', 'notes'],
  types: ['topic_opened', 'topic_noted'],
  columns: [
    { name: 'topic', kind: 'text' },
    { name: 'note', kind: 'text' },
    { name: 'last_message', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'next_at', kind: 'integer' },
    { name: 'due_at', kind: 'integer' },
  ],
  indexes: [{ name: 'due', columns: ['due_at'], acrossBrains: true, whereSet: 'due_at' }],
  keyOf: ({ type, data }) => Option.getOrUndefined(Option.map(decodeFact({ type, data }), (fact) => fact.data.topic)),
  advanced: { columns: ['open', 'next_at', 'due_at'], setBy: ['topic_opened'] },
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.flatMapNullishOr(decodeFact({ type: message.type, data: message.data }), (fact) =>
        rowAfterFact(row, fact, message),
      ),
    ),
};
