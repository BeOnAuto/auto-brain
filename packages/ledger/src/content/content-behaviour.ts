import { bytesOfText, contentOfText, mostContentChunkBytes, type Ledger } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  alpha,
  answerOfAbout,
  beta,
  brokenAfter,
  digestOf,
  generated,
  json,
  octets,
  readBack,
  readText,
  run,
  unread,
} from './content-samples.ts';
import { contentStaged, contentOfAnOlderShape } from './staged-content-behaviour.ts';

const ChunkRows = Schema.Array(Schema.Struct({ chunk: Schema.Number, bytes: Schema.Number }));

const HeadRows = Schema.Array(
  Schema.Struct({ sha256: Schema.String, bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

function chunkSizesOf(bytes: number): readonly number[] {
  return Array.from({ length: Math.ceil(bytes / mostContentChunkBytes) }, (_, index) =>
    Math.min(mostContentChunkBytes, bytes - index * mostContentChunkBytes),
  );
}

function chunksOfTheDigest(sha256: string): string {
  return `SELECT chunk, octet_length(data) AS bytes FROM recorded_content_chunks WHERE sha256 = '${sha256}' ORDER BY chunk`;
}

const theHeads =
  'SELECT sha256, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type FROM recorded_content_heads';

const countedChunks = 'SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks';

async function keptAndReadBack(entry: LedgerEntry, bytes: number) {
  const database = await entry.aDatabase();
  const ledger = await aLedger(entry, database);
  const { sha256, content } = await generated(bytes);
  await run(ledger.content.put(alpha, sha256, content()));
  return {
    sha256,
    chunks: Schema.decodeUnknownSync(ChunkRows)(await entry.queried(database, chunksOfTheDigest(sha256))),
    heads: Schema.decodeUnknownSync(HeadRows)(await entry.queried(database, theHeads)),
    read: await readBack(await run(ledger.content.get(alpha, sha256))),
  };
}

function contentKeptWhole(entry: LedgerEntry): void {
  describe('the content a brain recorded', () => {
    it.each([
      ['100 bytes', 100],
      ['64 KiB', 65_536],
      ['5 MB', 5_000_000],
      ['64 MiB', 67_108_864],
    ])(
      'keeps %s put as a stream whole, in chunks of 1 MiB under a head written last, and streams them back',
      { timeout: 120_000 },
      async (_size, bytes) => {
        const { sha256, chunks, heads, read } = await keptAndReadBack(entry, bytes);

        expect(read).toEqual({
          bytes,
          sha256,
          largestPiece: Math.min(bytes, mostContentChunkBytes),
          mediaType: octets,
          declared: bytes,
        });
        expect(heads).toEqual([{ sha256, bytes, chunks: chunks.length, media_type: octets }]);
        expect(chunks).toEqual(chunkSizesOf(bytes).map((size, chunk) => ({ chunk, bytes: size })));
      },
    );

    it('keeps a text as its UTF-8 bytes under the digest its fact carries, once however often it is put, in its brain alone', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const text = answerOfAbout(1_500_000);
      const sha256 = digestOf(text);
      const again = unread(bytesOfText(text));

      await run(ledger.content.put(alpha, sha256, contentOfText(text, json)));
      await run(ledger.content.put(alpha, sha256, again.content));
      const head = await readBack(await run(ledger.content.get(alpha, sha256)));
      const counted = Schema.decodeUnknownSync(CountRows)(await entry.queried(database, countedChunks));

      expect([head?.declared, head?.mediaType, head?.sha256, again.cancelled()]).toEqual([
        bytesOfText(text),
        json,
        sha256,
        true,
      ]);
      expect(await run(Effect.flatMap(ledger.content.get(alpha, sha256), readText))).toBe(text);
      expect(counted).toEqual([{ count: 2 }]);
      expect(await run(Effect.flatMap(ledger.content.get(beta, sha256), readText))).toBeUndefined();
      expect(await readBack(await run(ledger.content.get(alpha, digestOf('another answer'))))).toBeUndefined();
    });
  });
}

async function copiedUnder(entry: LedgerEntry, database: string, from: string, to: string): Promise<void> {
  await entry.queried(
    database,
    `INSERT INTO recorded_content_chunks (brain_key, sha256, chunk, data) SELECT brain_key, '${to}', chunk, data FROM recorded_content_chunks WHERE sha256 = '${from}'`,
  );
  await entry.queried(
    database,
    `INSERT INTO recorded_content_heads (brain_key, sha256, bytes, chunks, media_type) SELECT brain_key, '${to}', bytes, chunks, media_type FROM recorded_content_heads WHERE sha256 = '${from}'`,
  );
}

function readAsText(ledger: Ledger['Service'], sha256: string): Promise<string | undefined> {
  return run(Effect.flatMap(ledger.content.get(alpha, sha256), readText));
}

function contentReadBack(entry: LedgerEntry): void {
  describe('the content a brain recorded, read back', () => {
    it('fails as a defect on a read whose chunks are missing, or whose bytes are not those its digest names', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const text = answerOfAbout(2_500_000);
      const sha256 = digestOf(text);
      const other = digestOf('another answer');
      await run(ledger.content.put(alpha, sha256, contentOfText(text, json)));

      await copiedUnder(entry, database, sha256, other);
      await entry.queried(database, `DELETE FROM recorded_content_chunks WHERE sha256 = '${sha256}' AND chunk = 1`);

      await expect(readAsText(ledger, sha256)).rejects.toThrow(
        `The content kept under ${sha256} is not the bytes that digest names`,
      );
      await expect(readAsText(ledger, other)).rejects.toThrow(
        `The content kept under ${other} is not the bytes that digest names`,
      );
    });

    it('names nothing a put left before its head, or put under a digest its bytes are not, until the right bytes are put', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const { sha256, content } = await generated(2_500_000);
      const wrong = await generated(2_500_000, 11);

      await expect(
        run(ledger.content.put(alpha, sha256, brokenAfter(mostContentChunkBytes + 10, 2_500_000))),
      ).rejects.toThrow('The connection dropped');
      const leftBehind = Schema.decodeUnknownSync(CountRows)(await entry.queried(database, countedChunks));
      const afterTheCrash = await run(ledger.content.get(alpha, sha256));
      await expect(run(ledger.content.put(alpha, sha256, wrong.content()))).rejects.toThrow(
        `The content put under ${sha256} is not the bytes that digest names`,
      );
      const afterTheWrongBytes = await run(ledger.content.get(alpha, sha256));
      await run(ledger.content.put(alpha, sha256, content()));

      expect([leftBehind, afterTheCrash, afterTheWrongBytes]).toEqual([[{ count: 1 }], undefined, undefined]);
      expect(await readBack(await run(ledger.content.get(alpha, sha256)))).toMatchObject({ sha256, bytes: 2_500_000 });
    });
  });
}

export function contentBehaviour(entry: LedgerEntry): void {
  contentKeptWhole(entry);
  contentReadBack(entry);
  contentStaged(entry);
  contentOfAnOlderShape(entry);
}
