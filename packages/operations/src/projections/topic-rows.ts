import { Option, Result, Schema } from 'effect';

import type { Decider } from '../ledger/decider.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const OpenedSchema = Schema.Struct({ type: Schema.Literal('topic_opened'), topic: Schema.String, at: Schema.Int });

const NotedSchema = Schema.Struct({ type: Schema.Literal('topic_noted'), topic: Schema.String, note: Schema.String });

const TopicFactSchema = Schema.Union([OpenedSchema, NotedSchema]);

export type TopicFact = typeof TopicFactSchema.Type;

export const topicFacts: Decider<null, readonly TopicFact[], TopicFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
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
    const nextAt = fact.at + topicWaitMs;
    return {
      topic: fact.topic,
      note: row?.['note'] ?? null,
      last_message: id,
      open: true,
      next_at: nextAt,
      due_at: nextAt,
    };
  }
  return row === undefined ? undefined : { ...row, note: fact.note, last_message: id };
}

export const topicRows: KeyedProjection = {
  name: 'topics',
  version: 1,
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
  keyOf: (event) => Option.getOrUndefined(Option.map(decodeFact(event), ({ topic }) => topic)),
  advanced: { columns: ['open', 'next_at', 'due_at'], setBy: ['topic_opened'] },
  rowAfter: (row, event, message) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(event), (fact) => rowAfterFact(row, fact, message))),
};
