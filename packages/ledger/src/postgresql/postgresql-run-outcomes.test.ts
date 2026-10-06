import { runTallies, type RunFact } from '@beonauto/operations/testing';
import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import type { Query } from './postgresql-recorded.ts';
import {
  afterTheSchemaWithin,
  postgresqlRunOutcomeProjections,
  postgresqlRunOutcomesReader,
} from './postgresql-run-outcomes.ts';

interface Recording {
  readonly execute: StatementExecutor;
  readonly commands: string[];
}

type Answers = (statement: string) => readonly unknown[];

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function recording(answers: Answers): Recording {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: (sql) => Promise.resolve({ rows: answers(described(sql)) }),
      command: (sql) => {
        commands.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

const began: RunFact = { type: 'run_began', at: '2026-10-01T09:00:00.000Z', fn: 'triage' };

const indexes = [
  'ledger_messages_by_brain',
  'ledger_messages_by_brain_and_time',
  'ledger_messages_by_stream',
  'ledger_first_messages_by_kind',
].map((name) => ({ name }));

function aLedgerWithOneRun(tables: readonly string[]): Answers {
  return (statement) => {
    if (statement.includes('ledger_messages_by_brain')) {
      return indexes;
    }
    if (statement.includes('pg_class')) {
      return tables.map((name) => ({ name }));
    }
    if (statement.includes('FROM emt_streams')) {
      return statement.includes('s.stream_id > ""') ? [{ stream: 'brain/acme/alpha/executions/r1', size: 120 }] : [];
    }
    return [{ stream: 'brain/acme/alpha/executions/r1', type: 'run_began', data: { json: JSON.stringify(began) } }];
  };
}

const keptRow =
  'INSERT INTO run_outcomes_1 (brain_key, run_id, started_day, started_at, last_started_at, primitive, name, status, duration_ms, input_tokens, output_tokens, cached_tokens) VALUES ("brain/acme/alpha/", "r1", "2026-10-01", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "tally", "triage", "started", null, null, null, null) ON CONFLICT (brain_key, run_id) DO UPDATE SET started_day = excluded.started_day,';

describe('the table of the outcomes of runs on PostgreSQL, as the ledger opens', () => {
  it("is created after the brain's indexes, filled from the stored run streams, and analysed", async () => {
    const { execute, commands } = recording(aLedgerWithOneRun([]));

    await afterTheSchemaWithin(runTallies)({ execute });

    expect(commands.map((command) => command.split(' ').slice(0, 6).join(' '))).toEqual([
      'CREATE TABLE IF NOT EXISTS run_outcomes_1',
      'CREATE INDEX IF NOT EXISTS run_outcomes_1_by_brain_and_day',
      'INSERT INTO run_outcomes_1 (brain_key, run_id, started_day,',
      'ANALYZE run_outcomes_1',
    ]);
    expect(commands[2]?.startsWith(keptRow)).toBe(true);
  });

  it('is left as it is when it is found, and never made by a ledger without the projection', async () => {
    const found = recording(aLedgerWithOneRun(['run_outcomes_1']));
    const without = recording(aLedgerWithOneRun([]));

    await afterTheSchemaWithin(runTallies)({ execute: found.execute });
    await afterTheSchemaWithin()({ execute: without.execute });

    expect([found.commands, without.commands]).toEqual([[], []]);
  });
});

describe('the projection of the outcomes of runs on PostgreSQL', () => {
  it('reads each message out of the wrapper it is stored in, and keeps the row of its run', async () => {
    const { execute, commands } = recording(() => []);
    const [registration] = postgresqlRunOutcomeProjections(runTallies);
    const message = {
      type: 'run_began',
      data: { json: JSON.stringify(began) },
      metadata: { streamName: 'brain/acme/alpha/executions/r1' },
    };

    await registration?.projection.handle([message], { execute });

    expect(registration?.projection.canHandle).toEqual(['run_began', 'run_ended']);
    expect(commands[0]?.startsWith(keptRow)).toBe(true);
    expect(postgresqlRunOutcomeProjections()).toEqual([]);
  });
});

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(rows: readonly unknown[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text: text.replaceAll(/\s+/gu, ' '), values });
      return Promise.resolve(rows);
    },
  };
}

const group = {
  day: '2026-10-01',
  primitive: 'tally',
  name: 'triage',
  status: 'succeeded',
  runs: 2,
  input_tokens: 42,
  output_tokens: 40,
  cached_tokens: 2,
  durations: [120, 80],
};

describe('the read of the outcomes of runs on PostgreSQL', () => {
  it('groups the rows of the brain over the days of the window by day, function and status, in one statement', async () => {
    const { query, asked } = answering([group]);
    const read = postgresqlRunOutcomesReader(query);
    const window = { from: '2026-10-01', to: '2026-10-07' };

    const groups = await read('brain/acme/alpha/', window, { primitive: 'tally', name: 'triage' });
    await read('brain/acme/alpha/', window, {});

    expect(groups).toEqual([
      {
        day: '2026-10-01',
        primitive: 'tally',
        name: 'triage',
        status: 'succeeded',
        runs: 2,
        inputTokens: 42,
        outputTokens: 40,
        cachedTokens: 2,
        durations: [120, 80],
      },
    ]);
    expect(asked.map(({ values }) => values)).toEqual([
      ['brain/acme/alpha/', '2026-10-01', '2026-10-07', 'tally', 'triage'],
      ['brain/acme/alpha/', '2026-10-01', '2026-10-07'],
    ]);
    expect(asked[0]?.text).toContain(
      'WHERE brain_key = $1 AND started_day BETWEEN $2 AND $3 AND primitive = $4 AND name = $5 GROUP BY started_day, primitive, name, status',
    );
    expect(asked[1]?.text).toContain('BETWEEN $2 AND $3 GROUP BY');
  });
});
