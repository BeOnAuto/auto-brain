import { mostContentChunkBytes, sha256Of, textToKeep, type Ledger } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  alpha,
  answerOfAbout,
  beta,
  brokenAfter,
  deliveredBeforeFailing,
  generated,
  json,
  octets,
  present,
  readBack,
  readText,
  refusalOf,
  run,
} from './content-samples.ts';
import { contentOfAnOlderShape } from './older-content-shapes-behaviour.ts';
import { contentStaged } from './staged-content-behaviour.ts';
import { unnamedChunksSwept } from './unnamed-chunks-behaviour.ts';

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
  return `SELECT c.chunk, octet_length(c.data) AS bytes FROM recorded_content_chunks c
    JOIN recorded_content_heads h ON h.brain_key = c.brain_key AND h.upload_id = c.upload_id
    WHERE h.sha256 = '${sha256}' ORDER BY c.chunk`;
}

const theHeads =
  'SELECT sha256, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type FROM recorded_content_heads ORDER BY sha256';

const countedChunks = 'SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks';

const notItsBytes = (sha256: string) =>
  new Error(`The content kept under ${sha256} is not the bytes that digest names`);

async function chunksIn(entry: LedgerEntry, database: string): Promise<readonly { readonly count: number }[]> {
  return Schema.decodeUnknownSync(CountRows)(await entry.queried(database, countedChunks));
}

async function opened(entry: LedgerEntry) {
  const database = await entry.aDatabase();
  return { database, ledger: await aLedger(entry, database) };
}

async function keptAndReadBack(entry: LedgerEntry, bytes: number) {
  const { database, ledger } = await opened(entry);
  const { sha256, content } = await generated(bytes);
  const kept = await run(ledger.content.put(alpha, content()));
  return {
    sha256,
    kept,
    chunks: Schema.decodeUnknownSync(ChunkRows)(await entry.queried(database, chunksOfTheDigest(sha256))),
    heads: Schema.decodeUnknownSync(HeadRows)(await entry.queried(database, theHeads)),
    read: await readBack(await run(ledger.content.get(alpha, sha256))),
  };
}

function readAsText(ledger: Ledger['Service'], sha256: string): Promise<string | undefined> {
  return run(Effect.flatMap(ledger.content.get(alpha, sha256), readText));
}

function keptInChunks(entry: LedgerEntry): void {
  it.each([
    ['no bytes', 0],
    ['100 bytes', 100],
    ['64 KiB', 65_536],
    ['5 MB', 5_000_000],
    ['64 MiB', 67_108_864],
  ])(
    'keeps %s put as a stream whole, in chunks of 1 MiB under a head written last, answers its digest and size, and streams them back',
    { timeout: 120_000 },
    async (_size, bytes) => {
      const { sha256, kept, chunks, heads, read } = await keptAndReadBack(entry, bytes);

      expect(kept).toEqual({ sha256, bytes, mediaType: octets });
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
}

function keptOnce(entry: LedgerEntry): void {
  it('keeps a text as its UTF-8 under the digest its fact carries, once, with the media type it was first put with, in its brain alone', async () => {
    const { database, ledger } = await opened(entry);
    const text = answerOfAbout(1_500_000);
    const sha256 = sha256Of(text);

    const kept = [
      await run(ledger.content.put(alpha, textToKeep(text, json))),
      await run(ledger.content.put(alpha, textToKeep(text, 'text/plain'))),
    ];
    const read = await present(ledger.content.get(alpha, sha256));

    expect(kept).toEqual([
      { sha256, bytes: Buffer.byteLength(text), mediaType: json },
      { sha256, bytes: Buffer.byteLength(text), mediaType: json },
    ]);
    expect([read.mediaType, await readAsText(ledger, sha256)]).toEqual([json, text]);
    expect(await chunksIn(entry, database)).toEqual([{ count: 2 }]);
    expect(await run(Effect.flatMap(ledger.content.get(beta, sha256), readText))).toBeUndefined();
    expect(await run(ledger.content.get(alpha, sha256Of('another answer')))).toBeUndefined();
  });

  it('keeps a content it holds once, put again whole or with the digest it is expected to have', async () => {
    const { database, ledger } = await opened(entry);
    const small = await generated(1000);
    const large = await generated(2_500_000);
    await run(ledger.content.put(alpha, small.content()));
    await run(ledger.content.put(alpha, large.content()));

    const again = await Promise.all([
      run(ledger.content.put(alpha, small.content())),
      run(ledger.content.put(alpha, large.content())),
      run(ledger.content.put(alpha, { ...large.content(), expected: { sha256: large.sha256 } })),
    ]);

    expect(again).toEqual([
      { sha256: small.sha256, bytes: 1000, mediaType: octets },
      { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
      { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
    ]);
    expect(await chunksIn(entry, database)).toEqual([{ count: 4 }]);
  });
}

async function copiedUnder(entry: LedgerEntry, database: string, from: string, to: string): Promise<void> {
  await entry.queried(
    database,
    `INSERT INTO recorded_content_heads (brain_key, sha256, upload_id, bytes, chunks, media_type)
      SELECT brain_key, '${to}', upload_id, bytes, chunks, media_type FROM recorded_content_heads WHERE sha256 = '${from}'`,
  );
}

function readFailing(entry: LedgerEntry): void {
  it('fails as a defect on a read whose chunk is missing, after the chunks before it', async () => {
    const { database, ledger } = await opened(entry);
    const { sha256 } = await run(ledger.content.put(alpha, textToKeep(answerOfAbout(2_500_000), json)));

    await entry.queried(database, 'DELETE FROM recorded_content_chunks WHERE chunk = 1');
    const delivered = await deliveredBeforeFailing(await present(ledger.content.get(alpha, sha256)));

    expect(delivered).toEqual({
      bytes: mostContentChunkBytes,
      failure: new Error(`The content kept under ${sha256} is missing its chunk 1`),
    });
    await expect(readAsText(ledger, sha256)).rejects.toThrow(`The content kept under ${sha256} is missing its chunk 1`);
  });

  it('hands over no chunk of a read whose bytes are not those its digest names, before checking them', async () => {
    const { database, ledger } = await opened(entry);
    const { sha256: small } = await run(ledger.content.put(alpha, textToKeep('{"a":1}', json)));
    const { sha256: large } = await run(ledger.content.put(alpha, textToKeep(answerOfAbout(2_500_000), json)));
    const [oneChunk, threeChunks] = [sha256Of('one chunk'), sha256Of('three chunks')];
    await copiedUnder(entry, database, small, oneChunk);
    await copiedUnder(entry, database, large, threeChunks);

    const delivered = await Promise.all(
      [oneChunk, threeChunks].map(async (sha256) =>
        deliveredBeforeFailing(await present(ledger.content.get(alpha, sha256))),
      ),
    );

    expect(delivered).toEqual([
      { bytes: 0, failure: notItsBytes(oneChunk) },
      { bytes: 2 * mostContentChunkBytes, failure: notItsBytes(threeChunks) },
    ]);
  });
}

function putRefused(entry: LedgerEntry): void {
  it('refuses bytes of another digest or size than expected, and a stream that fails, keeping nothing of them', async () => {
    const { database, ledger } = await opened(entry);
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);

    const refused = await Promise.all([
      refusalOf(ledger.content.put(alpha, { ...wrong.content(), expected: { sha256: right.sha256 } })),
      refusalOf(ledger.content.put(alpha, { ...right.content(), expected: { bytes: 2_500_001 } })),
      refusalOf(ledger.content.put(alpha, brokenAfter(mostContentChunkBytes + 10))),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'not_its_digest',
        detail: `The content's SHA-256 is ${wrong.sha256}, where ${right.sha256} was expected`,
      }),
      expect.objectContaining({ _tag: 'content_refused', because: 'not_its_size' }),
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'stream_failed',
        cause: new Error('The connection dropped'),
      }),
    ]);
    expect([await chunksIn(entry, database), await run(ledger.content.get(alpha, right.sha256))]).toEqual([
      [{ count: 0 }],
      undefined,
    ]);
  });
}

function putRaced(entry: LedgerEntry): void {
  it('keeps the right bytes of a digest that a wrong put raced, and the chunks of one of two puts of a digest made at once', async () => {
    const { database, ledger } = await opened(entry);
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);
    const expected = { sha256: right.sha256 };

    const raced = await Promise.all([
      refusalOf(ledger.content.put(alpha, { ...wrong.content(), expected })),
      run(ledger.content.put(alpha, { ...right.content(), expected })),
      run(ledger.content.put(alpha, right.content())),
    ]);

    expect(raced).toEqual([
      expect.objectContaining({ because: 'not_its_digest' }),
      { sha256: right.sha256, bytes: 2_500_000, mediaType: octets },
      { sha256: right.sha256, bytes: 2_500_000, mediaType: octets },
    ]);
    expect(await readBack(await run(ledger.content.get(alpha, right.sha256)))).toMatchObject({
      sha256: right.sha256,
      bytes: 2_500_000,
    });
    expect(await chunksIn(entry, database)).toEqual([{ count: 3 }]);
  });
}

function heldDigestDefended(entry: LedgerEntry): void {
  it('refuses wrong bytes put with the digest of a content the brain holds, writing nothing and leaving the content whole', async () => {
    const { database, ledger } = await opened(entry);
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);
    await run(ledger.content.put(alpha, right.content()));

    const refused = await refusalOf(
      ledger.content.put(alpha, { ...wrong.content(), expected: { sha256: right.sha256 } }),
    );

    expect(refused).toMatchObject({ _tag: 'content_refused', because: 'not_its_digest' });
    expect(await readBack(await run(ledger.content.get(alpha, right.sha256)))).toMatchObject({
      sha256: right.sha256,
      bytes: 2_500_000,
    });
    expect(await chunksIn(entry, database)).toEqual([{ count: 3 }]);
  });
}

export function contentBehaviour(entry: LedgerEntry): void {
  describe('the content a brain recorded', () => {
    keptInChunks(entry);
    keptOnce(entry);
  });
  describe('the content a brain recorded, read back', () => {
    readFailing(entry);
  });
  describe('the content a brain was given to keep, refused', () => {
    putRefused(entry);
    heldDigestDefended(entry);
    putRaced(entry);
  });
  contentStaged(entry);
  unnamedChunksSwept(entry);
  contentOfAnOlderShape(entry);
}
