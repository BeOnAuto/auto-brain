import { Effect, Option, Schema } from 'effect';

import { defineQuery } from '../definition/operation.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const BeganSchema = Schema.Struct({ type: Schema.Literal('run_began'), at: Schema.String, fn: Schema.String });

const EndedSchema = Schema.Struct({
  type: Schema.Literal('run_ended'),
  status: Schema.Literals(['succeeded', 'failed', 'rejected']),
});

const NotedSchema = Schema.Struct({ type: Schema.Literal('run_noted') });

const decodeFact = Schema.decodeUnknownOption(Schema.Union([BeganSchema, EndedSchema, NotedSchema]));

export const tallyDueAfterMs = 60_000;

type TallyFact = Schema.Schema.Type<typeof BeganSchema | typeof EndedSchema | typeof NotedSchema>;

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: TallyFact,
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  if (fact.type === 'run_began') {
    const beganAt = Date.parse(fact.at);
    return {
      fn: fact.fn,
      began_at: beganAt,
      status: 'started',
      facts: 1,
      open: true,
      due_at: beganAt + tallyDueAfterMs,
      last_message: id,
    };
  }
  if (row === undefined) {
    return undefined;
  }
  const counted = { ...row, facts: Number(row['facts']) + 1, last_message: id };
  return fact.type === 'run_noted' ? counted : { ...counted, status: fact.status, open: false, due_at: null };
}

export function tallyRowsOf(version: number, fail?: (row: ProjectedRow) => boolean): KeyedProjection {
  return {
    name: 'run_tallies',
    kinds: ['executions'],
    version,
    types: ['run_began', 'run_ended', 'run_noted'],
    columns: [
      { name: 'fn', kind: 'text' },
      { name: 'began_at', kind: 'integer' },
      { name: 'status', kind: 'text' },
      { name: 'facts', kind: 'integer' },
      { name: 'open', kind: 'boolean' },
      { name: 'due_at', kind: 'integer' },
      { name: 'last_message', kind: 'text' },
    ],
    indexes: [
      { name: 'by_brain_and_status', columns: ['status', 'began_at'] },
      { name: 'due', columns: ['due_at'], acrossBrains: true, whereSet: 'due_at' },
    ],
    rowAfter: (row, event, message) =>
      Option.getOrUndefined(
        Option.flatMapNullishOr(decodeFact(event), (fact) => {
          const next = rowAfterFact(row, fact, message);
          if (next !== undefined && fail?.(next) === true) {
            throw new Error('The projection broke down');
          }
          return next;
        }),
      ),
  };
}

export const runTallyRows = tallyRowsOf(1);

export const readTallyRows = defineQuery('brain', {
  name: 'read_tally_rows',
  title: 'Read tally rows',
  description: 'Reads the rows of the runs of the brain that are still open, newest first, taking any limit.',
  route: { method: 'GET', path: '/tally-rows' },
  inputSchema: Schema.Struct({ limit: Schema.Int }),
  outputSchema: Schema.Struct({ runs: Schema.Array(Schema.String), open: Schema.Int }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ limit }) {
    const reader = yield* BrainReader;
    const where = [{ column: 'open', equals: true }];
    const rows = yield* reader.readProjectedRows('run_tallies', { where, orderBy: ['began_at'], order: 'desc', limit });
    return { runs: rows.map(({ key }) => key), open: yield* reader.countProjectedRows('run_tallies', where) };
  }),
});
