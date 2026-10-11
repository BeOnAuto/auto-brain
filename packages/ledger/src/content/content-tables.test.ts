import { contentOfText, mostContentChunkBytes, sha256Of } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { sqliteContentOn } from './content-store.ts';

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

const keptHead = { bytes: 4, chunks: 1, media_type: 'text/plain' };

describe('the writes of a recorded content', () => {
  it('write its chunks first, each on its own, and its head last', async () => {
    const { execute, statements } = recordingFinding([]);
    const text = 'x'.repeat(2 * mostContentChunkBytes + 1);

    await Effect.runPromise(
      sqliteContentOn(execute).put(alpha, await sha256Of(text), contentOfText(text, 'text/plain')),
    );

    expect(statements.map((statement) => kindOf(statement))).toEqual([
      'SELECT CAST(bytes AS',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_chunks',
      'INSERT INTO recorded_content_heads',
    ]);
  });

  it('write nothing for a digest the brain holds, and read no chunk of one it does not', async () => {
    const held = recordingFinding([keptHead]);
    const missing = recordingFinding([]);

    await Effect.runPromise(
      sqliteContentOn(held.execute).put(alpha, await sha256Of('kept'), contentOfText('kept', 'text/plain')),
    );
    const read = await Effect.runPromise(sqliteContentOn(missing.execute).get(alpha, 'digest'));

    expect(held.statements.map((statement) => kindOf(statement))).toEqual(['SELECT CAST(bytes AS']);
    expect([read, missing.statements.map((statement) => kindOf(statement))]).toEqual([
      undefined,
      ['SELECT CAST(bytes AS'],
    ]);
  });

  it('remove the head of each content staged under a build before its chunks', async () => {
    const { execute, statements } = recordingFinding([]);

    await Effect.runPromise(sqliteContentOn(execute).unstage(alpha, 'run-1'));

    expect(statements).toEqual([
      'DELETE FROM staged_content WHERE brain_key = "brain/acme/alpha/" AND run_id = "run-1"',
      'DELETE FROM staged_content_chunks WHERE brain_key = "brain/acme/alpha/" AND run_id = "run-1"',
    ]);
  });
});
