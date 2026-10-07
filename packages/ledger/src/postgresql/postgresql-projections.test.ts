import { runTallyRows } from '@beonauto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Query } from '../postgresql-reads/recorded-parts.ts';
import { formattedFor, postgresqlProjectionDialect, postgresqlProjectionsOf } from './postgresql-projections.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(rows: readonly unknown[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text: text.replaceAll(/\s+/gu, ' ').trim(), values });
      return Promise.resolve(rows);
    },
  };
}

const stored = {
  brain_key: 'brain/acme/alpha/',
  run_id: 'r1',
  fn: 'triage',
  began_at: 1000,
  status: 'started',
  facts: 1,
  open: true,
  due_at: 61_000,
  last_message: 'm1',
};

const alpha = { org: 'acme', brain: 'alpha' };

function readerOf(query: Query) {
  return postgresqlProjectionsOf({ projections: [runTallyRows] }).readerOn(formattedFor(query));
}

describe('the reads of a projection on PostgreSQL', () => {
  it('bind every value, read whole numbers as numbers and booleans as booleans', async () => {
    const { query, asked } = answering([stored]);
    const reader = readerOf(query);

    const rows = await Effect.runPromise(
      reader.readProjectedRows('run_tallies', alpha, {
        where: [{ column: 'open', equals: true }],
        orderBy: ['began_at'],
        order: 'desc',
        after: [2000, 'r9'],
        limit: 20,
      }),
    );

    expect(rows).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        runId: 'r1',
        row: {
          fn: 'triage',
          began_at: 1000,
          status: 'started',
          facts: 1,
          open: true,
          due_at: 61_000,
          last_message: 'm1',
        },
      },
    ]);
    expect(asked).toEqual([
      {
        text: 'SELECT brain_key, run_id, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message FROM run_tallies_1 WHERE brain_key = $1 AND open = $2 AND (began_at, run_id) < ($3, $4) ORDER BY began_at DESC NULLS LAST, run_id DESC NULLS LAST LIMIT $5',
        values: ['brain/acme/alpha/', true, 2000, 'r9', 20],
      },
    ]);
  });
});

describe('the counts and due times of a projection on PostgreSQL', () => {
  it('count, read what is due across brains, and the soonest due time', async () => {
    const counts = answering([{ count: 3 }]);
    const due = answering([stored]);
    const soonest = answering([{ due: 61_000 }]);

    expect(await Effect.runPromise(readerOf(counts.query).countProjectedRows('run_tallies', alpha, []))).toBe(3);
    expect(
      await Effect.runPromise(
        readerOf(due.query).readDueRows('run_tallies', {
          column: 'due_at',
          through: 70_000,
          limit: 256,
        }),
      ),
    ).toMatchObject([{ runId: 'r1', row: { open: true } }]);
    expect(await Effect.runPromise(readerOf(soonest.query).nextDueOf('run_tallies', 'due_at', 0))).toBe(61_000);
    expect([...counts.asked, ...due.asked, ...soonest.asked].map(({ text }) => text)).toEqual([
      'SELECT CAST(count(*) AS INTEGER) AS count FROM run_tallies_1 WHERE brain_key = $1',
      'SELECT brain_key, run_id, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message FROM run_tallies_1 WHERE due_at IS NOT NULL AND due_at <= $1 ORDER BY due_at, brain_key, run_id LIMIT $2',
      'SELECT min(due_at)::float8 AS due FROM run_tallies_1 WHERE due_at IS NOT NULL AND due_at > $1',
    ]);
  });

  it('fail for a column the projection does not have', async () => {
    const { query } = answering([]);

    const read = await Effect.runPromiseExit(
      readerOf(query).countProjectedRows('run_tallies', alpha, [{ column: 'state', equals: 'open' }]),
    );

    expect(Exit.isFailure(read)).toBe(true);
  });

  it('bind a boolean as PostgreSQL takes it', () => {
    expect([postgresqlProjectionDialect.booleanOf(true), postgresqlProjectionDialect.booleanOf(false)]).toEqual([
      true,
      false,
    ]);
  });
});
