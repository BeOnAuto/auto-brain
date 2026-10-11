import {
  mostContentChunkBytes,
  requireAsDeclared,
  streamPrefixOfBrain,
  type BrainAddress,
  type RecordedContent,
  type StreamedContent,
} from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { sqliteContent, type ContentDialect } from './content-dialects.ts';
import { verifiedStream, writtenInChunks, type Head, type Written } from './content-streams.ts';
import { keptShelf, stagingShelf, type Shelf } from './content-tables.ts';

type Key = readonly (readonly [column: string, value: string])[];

interface Place {
  readonly key: Key;
  readonly sha256: string;
}

interface KeptHead extends Head {
  readonly mediaType: string;
}

interface Shelved {
  readonly execute: StatementExecutor;
  readonly dialect: ContentDialect;
  readonly shelf: Shelf;
}

const HeadRows = Schema.Array(
  Schema.Struct({ bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const ChunkRows = Schema.Array(Schema.Struct({ data: Schema.Uint8Array }));

function wholeKeyOf({ key, sha256 }: Place): Key {
  return [...key, ['sha256', sha256]];
}

function matching(key: Key): SQL {
  return SQL.merge(
    key.map(([column, value]) => SQL`${SQL.identifier(column)} = ${value}`),
    ' AND ',
  );
}

function columnsOf(key: Key, ...more: readonly string[]): SQL {
  return SQL.merge(
    [...key.map(([column]) => column), ...more].map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

function valuesOf(key: Key): SQL {
  return SQL.merge(
    key.map(([, value]) => SQL`${value}`),
    ', ',
  );
}

function hexOf(chunk: Readonly<Uint8Array>): string {
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('hex');
}

async function headOf({ execute, shelf }: Shelved, key: Key): Promise<KeptHead | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type
      FROM ${SQL.identifier(shelf.heads)} WHERE ${matching(key)}`,
  );
  const head = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
  return head === undefined ? undefined : { bytes: head.bytes, chunks: head.chunks, mediaType: head.media_type };
}

async function chunkOf({ execute, shelf }: Shelved, key: Key, index: number): Promise<Uint8Array | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT data FROM ${SQL.identifier(shelf.chunks)} WHERE ${matching(key)} AND chunk = ${index}`,
  );
  return Schema.decodeUnknownSync(ChunkRows)(rows).at(0)?.data;
}

function chunksWritten({ execute, dialect, shelf }: Shelved, key: Key, { stream }: StreamedContent): Promise<Written> {
  return writtenInChunks(stream, mostContentChunkBytes, (chunk, index) =>
    execute.command(
      SQL`INSERT INTO ${SQL.identifier(shelf.chunks)} (${columnsOf(key, 'chunk', 'data')})
        VALUES (${valuesOf(key)}, ${index}, ${dialect.bytesOfHex(hexOf(chunk))})
        ON CONFLICT (${columnsOf(key, 'chunk')}) DO UPDATE SET data = excluded.data
        WHERE NOT EXISTS (SELECT 1 FROM ${SQL.identifier(shelf.heads)} WHERE ${matching(key)})`,
    ),
  );
}

async function kept(shelved: Shelved, place: Place, content: StreamedContent): Promise<void> {
  const key = wholeKeyOf(place);
  if ((await headOf(shelved, key)) !== undefined) {
    await content.stream.cancel();
    return;
  }
  const written = await chunksWritten(shelved, key, content);
  requireAsDeclared(place.sha256, content.bytes, written);
  await shelved.execute.command(
    SQL`INSERT INTO ${SQL.identifier(shelved.shelf.heads)} (${columnsOf(key, 'bytes', 'chunks', 'media_type')})
      VALUES (${valuesOf(key)}, ${written.bytes}, ${written.chunks}, ${content.mediaType})
      ON CONFLICT DO NOTHING`,
  );
}

async function read(shelved: Shelved, place: Place): Promise<StreamedContent | undefined> {
  const key = wholeKeyOf(place);
  const head = await headOf(shelved, key);
  return head === undefined
    ? head
    : {
        stream: verifiedStream(place.sha256, head, (index) => chunkOf(shelved, key, index)),
        bytes: head.bytes,
        mediaType: head.mediaType,
      };
}

async function removed({ execute, shelf }: Shelved, key: Key): Promise<void> {
  await execute.command(SQL`DELETE FROM ${SQL.identifier(shelf.heads)} WHERE ${matching(key)}`);
  await execute.command(SQL`DELETE FROM ${SQL.identifier(shelf.chunks)} WHERE ${matching(key)}`);
}

function brainKeyOf(brain: BrainAddress): Key {
  return [['brain_key', streamPrefixOfBrain(brain)]];
}

function buildKeyOf(brain: BrainAddress, build: string): Key {
  return [...brainKeyOf(brain), ['run_id', build]];
}

export function recordedContentOn(execute: StatementExecutor, dialect: ContentDialect): RecordedContent {
  const keeping: Shelved = { execute, dialect, shelf: keptShelf };
  const staging: Shelved = { execute, dialect, shelf: stagingShelf };
  return {
    put: (brain, sha256, content) => Effect.promise(() => kept(keeping, { key: brainKeyOf(brain), sha256 }, content)),
    get: (brain, sha256) => Effect.promise(() => read(keeping, { key: brainKeyOf(brain), sha256 })),
    stage: (brain, build, sha256, content) =>
      Effect.promise(() => kept(staging, { key: buildKeyOf(brain, build), sha256 }, content)),
    staged: (brain, build, sha256) => Effect.promise(() => read(staging, { key: buildKeyOf(brain, build), sha256 })),
    unstage: (brain, build) => Effect.promise(() => removed(staging, buildKeyOf(brain, build))),
  };
}

export function sqliteContentOn(execute: StatementExecutor): RecordedContent {
  return recordedContentOn(execute, sqliteContent);
}
