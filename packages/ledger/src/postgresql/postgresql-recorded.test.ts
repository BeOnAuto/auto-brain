import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import { createPostgreSQLBrainIndexes, postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(...answers: readonly (readonly unknown[])[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve(answers[asked.length - 1] ?? []);
    },
  };
}

const alpha = 'brain/acme/alpha/';

const at = '2026-10-05T09:00:00.000Z';

function examined(transaction: string, position: string, wanted: boolean) {
  return { transaction, position, stream: `${alpha}notes`, type: 'noted', recorded: at, wanted, size: wanted ? 10 : 0 };
}

function stored(transaction: string, position: string, detail: string) {
  return { transaction, position, data: { json: JSON.stringify({ type: 'noted', detail }) } };
}

function run(transaction: string, position: string, latest: readonly [string, string, string]) {
  return {
    ...examined(transaction, position, true),
    examined: 1,
    latest_transaction: latest[0],
    latest_position: latest[1],
    latest_type: latest[2],
    latest_recorded: at,
  };
}

describe('the read of what a brain recorded on PostgreSQL', () => {
  it('orders by transaction id then position, and reads behind the oldest open transaction', async () => {
    const { query, asked } = answering(
      [examined('11', '21', false), examined('11', '22', true), examined('12', '23', true)],
      [stored('11', '22', 'second')],
    );

    const page = await postgresqlRecordedStore(query).readRecorded(
      alpha,
      { kind: 'everything' },
      { order: 'asc', limit: 2, after: ['10', '20'], types: ['noted'] },
    );

    expect(page).toEqual({
      records: [
        {
          point: ['11', '22'],
          stream: `${alpha}notes`,
          type: 'noted',
          recordedAt: at,
          data: { type: 'noted', detail: 'second' },
        },
      ],
      resumeAfter: ['11', '22'],
    });
    expect(asked[0]?.text).toContain('AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())');
    expect(asked[0]?.text).toContain('AND (transaction_id, global_position) > ($4::xid8, $5::bigint)');
    expect(asked[0]?.text).toContain('ORDER BY transaction_id ASC, global_position ASC');
    expect(asked[0]?.values).toEqual([['noted'], alpha, 'emt:default', '10', '20', 3]);
    expect(asked[1]?.values).toEqual([['11'], ['22'], 'emt:default']);
  });
});

describe('a read of one run on PostgreSQL', () => {
  it('reads it newest first, after a cursor and from the first message recorded at or after a time', async () => {
    const { query, asked } = answering(
      [{ transaction: '7', position: '8' }],
      [examined('9', '10', true)],
      [stored('9', '10', 'only')],
    );

    const page = await postgresqlRecordedStore(query).readRecorded(
      alpha,
      { kind: 'run', execution: 'r1' },
      { order: 'desc', limit: 5, since: at, after: ['30', '40'] },
    );

    expect(page.records.map(({ data }) => data)).toEqual([{ type: 'noted', detail: 'only' }]);
    expect(asked[0]?.values).toEqual([alpha, 'emt:default', at]);
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) < ($3::xid8, $4::bigint)');
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) >= ($5::xid8, $6::bigint)');
    expect(asked[1]?.text).toContain('ORDER BY transaction_id DESC, global_position DESC');
    expect(asked[1]?.values).toEqual([
      [`${alpha}executions/r1`, `${alpha}runs/r1`],
      'emt:default',
      '30',
      '40',
      '7',
      '8',
      6,
    ]);
  });
});

describe('a read on PostgreSQL from a time', () => {
  it('answers nothing when nothing was recorded from the time asked', async () => {
    const { query, asked } = answering([]);

    expect(
      await postgresqlRecordedStore(query).readRecorded(
        alpha,
        { kind: 'everything' },
        { order: 'asc', limit: 5, since: at },
      ),
    ).toEqual({
      records: [],
    });
    expect(asked).toHaveLength(1);
  });
});

describe('a read of runs on PostgreSQL', () => {
  it('gives the first and the latest message of each run, and the first alone for a run of one message', async () => {
    const { query } = answering(
      [
        run('3', '4', ['3', '4', 'execution_started']),
        { ...run('1', '2', ['5', '6', 'execution_succeeded']), examined: 2 },
      ],
      [stored('3', '4', 'r2'), stored('1', '2', 'r1'), stored('5', '6', 'r1 done')],
    );

    const page = await postgresqlRecordedStore(query).readRecorded(
      alpha,
      { kind: 'executions' },
      { order: 'desc', limit: 5 },
    );

    expect(page.records.map(({ type, data }) => [type, data])).toEqual([
      ['noted', { type: 'noted', detail: 'r2' }],
      ['noted', { type: 'noted', detail: 'r1' }],
      ['execution_succeeded', { type: 'noted', detail: 'r1 done' }],
    ]);
  });
});

describe("the brain's indexes on PostgreSQL", () => {
  it('index the brain key by position and by recorded time, and the first messages by brain and kind', async () => {
    const commands: string[] = [];
    const execute: SQLExecutor = {
      query: () => Promise.resolve({ rowCount: 0, rows: [] }),
      batchQuery: () => Promise.resolve([]),
      command: (sql: SQL) => {
        commands.push(SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' '));
        return Promise.resolve({ rowCount: 0, rows: [] });
      },
      batchCommand: () => Promise.resolve([]),
    };

    await createPostgreSQLBrainIndexes({ execute });

    expect(commands).toEqual([
      "CREATE INDEX IF NOT EXISTS ledger_messages_by_brain ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){3}')), transaction_id, global_position)",
      "CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_time ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){3}')), created, transaction_id, global_position)",
      "CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){4}')), transaction_id, global_position) WHERE stream_position = 1",
    ]);
  });
});
