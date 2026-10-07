import { runTallies, type RunFact } from '@beonauto/operations/testing';
import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { aRecordedFillOf, mebibyte, runIdsOf, type RecordedFill } from '../outcomes/recorded-fill.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';
import type { Query } from './postgresql-recorded.ts';
import {
  emmettsMigrationLock,
  longestMigrationLockWaitMs,
  migrationLockTakenWithin,
  postgresqlRunOutcomesReader,
} from './postgresql-run-outcomes.ts';

const tallied = postgresqlProjectionsOf({ runOutcomes: runTallies });

const untallied = postgresqlProjectionsOf({});

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
  'ledger_messages_by_brain_and_correlation',
  'ledger_definition_streams',
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
    return [
      {
        stream: 'brain/acme/alpha/executions/r1',
        type: 'run_began',
        data: { json: JSON.stringify(began) },
        position: 1,
      },
    ];
  };
}

const keptRow =
  'INSERT INTO run_outcomes_1 (brain_key, run_id, started_day, started_at, last_started_at, primitive, name, status, duration_ms, input_tokens, output_tokens, cached_tokens) VALUES ("brain/acme/alpha/", "r1", "2026-10-01", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "tally", "triage", "started", null, null, null, null) ON CONFLICT (brain_key, run_id) DO UPDATE SET started_day = excluded.started_day,';

describe('the table of the outcomes of runs on PostgreSQL, as the ledger opens', () => {
  it("is created after the brain's indexes, filled from the stored run streams, and analysed", async () => {
    const { execute, commands } = recording(aLedgerWithOneRun([]));

    await tallied.afterTheSchema({ execute });

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

    await tallied.afterTheSchema({ execute: found.execute });
    await untallied.afterTheSchema({ execute: without.execute });

    expect([found.commands, without.commands]).toEqual([[], []]);
  });
});

async function filledOnPostgreSQL(sizes: readonly number[]): Promise<RecordedFill> {
  const fill = aRecordedFillOf(
    sizes,
    (sql) => SQL.describe(sql, pgFormatter),
    (json) => ({ json }),
  );
  await tallied.afterTheSchema({ execute: fill.execute });
  return fill;
}

describe('the listings of the fill on PostgreSQL', () => {
  it('ask for one run stream, then twice as many after each batch that took them all, up to 100', async () => {
    const fill = await filledOnPostgreSQL(Array.from({ length: 300 }, () => 120));

    expect(fill.listings).toEqual([1, 2, 4, 8, 16, 32, 64, 100, 100]);
    expect(fill.keptRuns()).toEqual(runIdsOf(300));
  });

  it('ask for one again after a run stream that holds more than 16 MiB alone, and keep every run', async () => {
    const fill = await filledOnPostgreSQL([120, 120, 120, 20 * mebibyte, 120, 120, 120, 120, 120, 120]);

    expect(fill.listings).toEqual([1, 2, 4, 1, 2, 4]);
    expect(fill.keptRuns()).toEqual(runIdsOf(10));
  });
});

describe('the projection of the outcomes of runs on PostgreSQL', () => {
  it('reads each message out of the wrapper it is stored in, and keeps the row of its run', async () => {
    const { execute, commands } = recording(() => []);
    const [registration] = tallied.registrations;
    const message = {
      type: 'run_began',
      data: { json: JSON.stringify(began) },
      metadata: { streamName: 'brain/acme/alpha/executions/r1', messageId: 'm1', streamPosition: 1n },
    };

    await registration?.projection.handle([message], { execute });

    expect(registration?.projection.canHandle).toEqual(['run_began', 'run_ended']);
    expect(commands[0]?.startsWith(keptRow)).toBe(true);
    expect(untallied.registrations).toEqual([]);
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

interface HeldLock {
  readonly execute: StatementExecutor;
  readonly tries: () => readonly string[];
}

function aLockHeldWhile(held: (tries: number) => boolean): HeldLock {
  const tries: string[] = [];
  return {
    tries: () => tries,
    execute: {
      query: (sql) => {
        tries.push(described(sql));
        return Promise.resolve({ rows: [{ locked: !held(tries.length) }] });
      },
      command: (sql) => Promise.reject(new Error(`The wait for the lock commands nothing: ${described(sql)}`)),
    },
  };
}

function aFakeClock() {
  const clock = { at: 0 };
  return {
    elapsed: () => clock.at,
    waiting: {
      mostWaitMs: longestMigrationLockWaitMs,
      now: () => clock.at,
      pause: (milliseconds: number) => {
        clock.at += milliseconds;
        return Promise.resolve();
      },
    },
  };
}

const lockTried = `SELECT pg_try_advisory_xact_lock(${emmettsMigrationLock}) AS locked`;

describe('the wait of a server that starts for the migration lock of the ledger on PostgreSQL', () => {
  it('takes the lock the migrator takes, in the migration, trying again every 100 ms until it is free', async () => {
    const held = aLockHeldWhile((tries) => tries < 2);

    await migrationLockTakenWithin()({ execute: held.execute });

    expect(held.tries()).toEqual([lockTried, lockTried]);
  });

  it('waits past the 10 s the migrator itself waits, while another server fills the ledger, and goes on once it is done', async () => {
    const clock = aFakeClock();
    const held = aLockHeldWhile(() => clock.elapsed() < 12_000);

    await migrationLockTakenWithin(clock.waiting)({ execute: held.execute });

    expect({ elapsed: clock.elapsed(), tries: held.tries().length }).toEqual({ elapsed: 12_000, tries: 121 });
  });

  it('stops the start, saying why, when the lock is still held after 60 s', async () => {
    const clock = aFakeClock();
    const held = aLockHeldWhile(() => true);

    await expect(migrationLockTakenWithin(clock.waiting)({ execute: held.execute })).rejects.toThrow(
      "Another server held the migration lock of the ledger's database for more than 60 s, so this one does not start; start it again once that server is ready",
    );
    expect(clock.elapsed()).toBe(longestMigrationLockWaitMs);
  });
});
