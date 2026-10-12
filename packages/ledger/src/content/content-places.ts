import {
  notTheBytesOfItsDigest,
  sha256Digest,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type ContentKept,
  type StreamedContent,
} from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { ContentDialect } from './content-dialects.ts';
import type { Shelf } from './content-tables.ts';

export type Key = readonly (readonly [column: string, value: string])[];

export interface KeptHead extends ContentKept {
  readonly uploadId: string;
  readonly chunks: number;
}

export interface Shelved {
  readonly execute: StatementExecutor;
  readonly dialect: ContentDialect;
  readonly shelf: Shelf;
}

interface Head {
  readonly bytes: number;
  readonly chunks: number;
}

type ChunkRead = (index: number) => Promise<Uint8Array | undefined>;

interface ChunkReading {
  readonly read: ChunkRead;
  readonly missing: (index: number) => Error;
}

function verifiedStream(sha256: string, head: Head, { read, missing }: ChunkReading): ReadableStream<Uint8Array> {
  const digest = sha256Digest();
  let bytes = 0;
  let index = 0;
  const ended = (controller: ReadableStreamDefaultController<Uint8Array>, last?: Readonly<Uint8Array>) => {
    if (bytes !== head.bytes || digest.hex() !== sha256) {
      controller.error(notTheBytesOfItsDigest(sha256));
      return;
    }
    if (last !== undefined) {
      controller.enqueue(last);
    }
    controller.close();
  };
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (index === head.chunks) {
        ended(controller);
        return;
      }
      const chunk = await read(index);
      if (chunk === undefined) {
        controller.error(missing(index));
        return;
      }
      digest.update(chunk);
      bytes += chunk.byteLength;
      index += 1;
      if (index < head.chunks) {
        controller.enqueue(chunk);
      } else {
        ended(controller, chunk);
      }
    },
  });
}

const HeadRows = Schema.Array(
  Schema.Struct({ upload_id: Schema.String, bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const ChunkRows = Schema.Array(Schema.Struct({ data: Schema.Uint8Array }));

export function matching(key: Key): SQL {
  return SQL.merge(
    key.map(([column, value]) => SQL`${SQL.identifier(column)} = ${value}`),
    ' AND ',
  );
}

export function columnsOf(key: Key, ...more: readonly string[]): SQL {
  return SQL.merge(
    [...key.map(([column]) => column), ...more].map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

export function valuesOf(key: Key): SQL {
  return SQL.merge(
    key.map(([, value]) => SQL`${value}`),
    ', ',
  );
}

export function hexOf(chunk: Readonly<Uint8Array>): string {
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('hex');
}

export function queried({ execute }: Shelved, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.query(sql)).rows);
}

export function commanded({ execute }: Shelved, sql: SQL): Effect.Effect<void> {
  return Effect.asVoid(Effect.promise(() => execute.command(sql)));
}

export function headOf(shelved: Shelved, place: Key, sha256: string): Effect.Effect<KeptHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type
        FROM ${SQL.identifier(shelved.shelf.heads)} WHERE ${matching(place)} AND sha256 = ${sha256}`,
    ),
    (rows) => {
      const head = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
      return head === undefined
        ? undefined
        : { sha256, uploadId: head.upload_id, bytes: head.bytes, chunks: head.chunks, mediaType: head.media_type };
    },
  );
}

async function chunkOf({ execute, shelf }: Shelved, upload: Key, index: number): Promise<Uint8Array | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT data FROM ${SQL.identifier(shelf.chunks)} WHERE ${matching(upload)} AND chunk = ${index}`,
  );
  return Schema.decodeUnknownSync(ChunkRows)(rows).at(0)?.data;
}

export function uploadOf(place: Key, uploadId: string): Key {
  return [...place, ['upload_id', uploadId]];
}

export interface Upload {
  readonly uploadId: string;
  readonly sha256: string | undefined;
}

export function uploadRemoved(shelved: Shelved, place: Key, { uploadId, sha256 }: Upload): Effect.Effect<void> {
  const upload = uploadOf(place, uploadId);
  const { chunks, heads } = shelved.shelf;
  return commanded(
    shelved,
    sha256 === undefined
      ? SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(upload)}`
      : SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(upload)}
          AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${matching([...upload, ['sha256', sha256]])})`,
  );
}

export function readOn(shelved: Shelved, place: Key, sha256: string): Effect.Effect<StreamedContent | undefined> {
  return Effect.map(headOf(shelved, place, sha256), (head) =>
    head === undefined
      ? head
      : {
          stream: verifiedStream(sha256, head, {
            read: (index) => chunkOf(shelved, uploadOf(place, head.uploadId), index),
            missing: (index) => shelved.shelf.chunkMissing(sha256, index),
          }),
          bytes: head.bytes,
          mediaType: head.mediaType,
        },
  );
}

export function playbookPlaceOf(playbook: PlaybookAddress): Key {
  return [['playbook_key', streamPrefixOfPlaybook(playbook)]];
}

export function runPlaceOf(playbook: PlaybookAddress, run: string): Key {
  return [...playbookPlaceOf(playbook), ['run_id', run]];
}
