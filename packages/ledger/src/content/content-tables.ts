import { bytesOfText, chunksOf, streamPrefixOfBrain, type RecordedContent } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { createMissingIndexes, type BrainIndex } from '../recorded/missing-indexes.ts';

const contentTables: readonly BrainIndex[] = [
  {
    name: 'recorded_content_chunks',
    create: () => SQL`CREATE TABLE IF NOT EXISTS recorded_content_chunks (
      brain_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      chunk INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (brain_key, sha256, chunk)
    )`,
  },
  {
    name: 'recorded_content_heads',
    create: () => SQL`CREATE TABLE IF NOT EXISTS recorded_content_heads (
      brain_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      PRIMARY KEY (brain_key, sha256)
    )`,
  },
];

export const contentTableNames: readonly string[] = contentTables.map(({ name }) => name);

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const HeadRows = Schema.Array(Schema.Struct({ chunks: Schema.Number }));

const ChunkRows = Schema.Array(Schema.Struct({ text: Schema.String }));

async function headOf(execute: StatementExecutor, brainKey: string, sha256: string) {
  const { rows } = await execute.query(
    SQL`SELECT chunks FROM recorded_content_heads WHERE brain_key = ${brainKey} AND sha256 = ${sha256}`,
  );
  return Schema.decodeUnknownSync(HeadRows)(rows).at(0);
}

async function kept(execute: StatementExecutor, brainKey: string, sha256: string, text: string): Promise<void> {
  if ((await headOf(execute, brainKey, sha256)) !== undefined) {
    return;
  }
  const chunks = chunksOf(text);
  await inTurn([...chunks.entries()], ([chunk, part]: readonly [number, string]) =>
    execute.command(
      SQL`INSERT INTO recorded_content_chunks (brain_key, sha256, chunk, text)
        VALUES (${brainKey}, ${sha256}, ${chunk}, ${part})
        ON CONFLICT DO NOTHING`,
    ),
  );
  await execute.command(
    SQL`INSERT INTO recorded_content_heads (brain_key, sha256, bytes, chunks)
      VALUES (${brainKey}, ${sha256}, ${bytesOfText(text)}, ${chunks.length})
      ON CONFLICT DO NOTHING`,
  );
}

async function read(execute: StatementExecutor, brainKey: string, sha256: string): Promise<string | undefined> {
  const head = await headOf(execute, brainKey, sha256);
  if (head === undefined) {
    return undefined;
  }
  const { rows } = await execute.query(
    SQL`SELECT text FROM recorded_content_chunks WHERE brain_key = ${brainKey} AND sha256 = ${sha256} ORDER BY chunk`,
  );
  return Schema.decodeUnknownSync(ChunkRows)(rows)
    .map(({ text }) => text)
    .join('');
}

export function recordedContentOn(execute: StatementExecutor): RecordedContent {
  return {
    put: (brain, sha256, text) => Effect.promise(() => kept(execute, streamPrefixOfBrain(brain), sha256, text)),
    get: (brain, sha256) => Effect.promise(() => read(execute, streamPrefixOfBrain(brain), sha256)),
  };
}

export async function createdContentTables(execute: StatementExecutor, existingTables: SQL): Promise<void> {
  const { rows } = await execute.query(existingTables);
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  await createMissingIndexes(execute, contentTables, existing);
}
