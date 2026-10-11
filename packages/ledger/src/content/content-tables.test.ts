import { mostContentChunkBytes } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { recordedContentOn } from './content-tables.ts';

const alpha = { org: 'acme', brain: 'alpha' };

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function recordingFinding(heads: readonly unknown[]): {
  readonly execute: StatementExecutor;
  readonly statements: readonly string[];
} {
  const statements: string[] = [];
  return {
    statements,
    execute: {
      query: (sql) => {
        statements.push(described(sql));
        return Promise.resolve({ rows: heads });
      },
      command: (sql) => {
        statements.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

function kindOf(statement: string): string {
  return statement.split(' ').slice(0, 3).join(' ');
}

describe('the writes of a recorded content', () => {
  it('write its chunks first, each on its own, and its head last', async () => {
    const { execute, statements } = recordingFinding([]);

    await Effect.runPromise(recordedContentOn(execute).put(alpha, 'digest', 'x'.repeat(2 * mostContentChunkBytes + 1)));

    expect(statements.map((statement) => kindOf(statement))).toEqual([
      'SELECT chunks FROM',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_heads',
    ]);
  });

  it('write nothing for a digest the brain holds, and read no chunk of one it does not', async () => {
    const held = recordingFinding([{ chunks: 1 }]);
    const missing = recordingFinding([]);

    await Effect.runPromise(recordedContentOn(held.execute).put(alpha, 'digest', 'kept'));
    const read = await Effect.runPromise(recordedContentOn(missing.execute).get(alpha, 'digest'));

    expect(held.statements.map((statement) => kindOf(statement))).toEqual(['SELECT chunks FROM']);
    expect([read, missing.statements.map((statement) => kindOf(statement))]).toEqual([
      undefined,
      ['SELECT chunks FROM'],
    ]);
  });
});
