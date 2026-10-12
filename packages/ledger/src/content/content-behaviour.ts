import { createHash } from 'node:crypto';

import { bytesOfText, mostContentChunkBytes, type PlaybookAddress, type Ledger } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

function answerOfAbout(bytes: number): string {
  const rows: { readonly id: number; readonly note: string }[] = [];
  let size = 10;
  while (size < bytes) {
    const row = { id: rows.length, note: `${String(rows.length).repeat(8)} é ✓ 𝄞 \u0000 "quoted" ${'x'.repeat(40)}` };
    rows.push(row);
    size += bytesOfText(JSON.stringify(row)) + 1;
  }
  return JSON.stringify({ rows });
}

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const ChunkRows = Schema.Array(Schema.Struct({ chunk: Schema.Number, bytes: Schema.Number }));

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const KeyRows = Schema.Array(Schema.Struct({ sha256: Schema.String }));

function chunksOfTheDigest(sha256: string): string {
  return `SELECT chunk, octet_length(text) AS bytes FROM recorded_content_chunks WHERE sha256 = '${sha256}' ORDER BY chunk`;
}

const keysOfTheHeads = 'SELECT sha256 FROM recorded_content_heads';

function kept(ledger: Ledger['Service'], text: string, playbook: PlaybookAddress = alpha): Promise<string> {
  const sha256 = digestOf(text);
  return Effect.runPromise(ledger.content.put(playbook, sha256, text)).then(() => sha256);
}

function contentKeptWhole(entry: LedgerEntry): void {
  describe('the content a playbook recorded', () => {
    it.each([
      ['100 bytes', 100],
      ['64 KiB', 65_536],
      ['5 MB', 5_000_000],
      ['16 MiB', 16_777_216],
    ])(
      'keeps an answer of %s whole, in chunks of at most 1 MiB cut at a code point, and joins them back exactly',
      async (_size, bytes) => {
        const database = await entry.aDatabase();
        const ledger = await aLedger(entry, database);
        const text = answerOfAbout(bytes);

        const sha256 = await kept(ledger, text);
        const chunks = Schema.decodeUnknownSync(ChunkRows)(await entry.queried(database, chunksOfTheDigest(sha256)));
        const keys = Schema.decodeUnknownSync(KeyRows)(await entry.queried(database, keysOfTheHeads));
        const read = await Effect.runPromise(ledger.content.get(alpha, sha256));

        expect(read).toBe(text);
        expect(keys).toEqual([{ sha256: digestOf(String(read)) }]);
        expect(chunks.map(({ chunk }) => chunk)).toEqual(chunks.map((_chunk, index) => index));
        expect(chunks.length).toBeGreaterThanOrEqual(Math.ceil(bytesOfText(text) / mostContentChunkBytes));
        expect(chunks.every((chunk) => chunk.bytes <= mostContentChunkBytes)).toBe(true);
      },
    );

    it('keeps an answer received twice once, and reads it in its own playbook alone', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const text = answerOfAbout(1_500_000);

      const sha256 = await kept(ledger, text);
      await kept(ledger, text);
      const counted = Schema.decodeUnknownSync(CountRows)(
        await entry.queried(database, 'SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks'),
      );

      expect(counted).toEqual([{ count: 2 }]);
      expect(await Effect.runPromise(ledger.content.get(beta, sha256))).toBeUndefined();
      expect(await Effect.runPromise(ledger.content.get(alpha, digestOf('another answer')))).toBeUndefined();
    });
  });
}

function contentReadBack(entry: LedgerEntry): void {
  describe('the content a playbook recorded, read back', () => {
    it('fails as a defect on a read whose chunks no longer join to the text its key names', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const sha256 = await kept(ledger, answerOfAbout(2_500_000));

      await entry.queried(database, `DELETE FROM recorded_content_chunks WHERE sha256 = '${sha256}' AND chunk = 1`);

      await expect(Effect.runPromise(ledger.content.get(alpha, sha256))).rejects.toThrow(
        `The content kept under ${sha256} is not the text that digest names`,
      );
    });

    it('names no content until its head is written after its chunks, and a later write of the text completes it', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      const text = JSON.stringify({ rows: ['kept whole'] });
      const sha256 = digestOf(text);

      await entry.queried(
        database,
        `INSERT INTO recorded_content_chunks (brain_key, sha256, chunk, text) VALUES ('brain/acme/alpha/', '${sha256}', 0, '${text}')`,
      );
      const beforeTheHead = await Effect.runPromise(ledger.content.get(alpha, sha256));
      await kept(ledger, text);

      expect([beforeTheHead, await Effect.runPromise(ledger.content.get(alpha, sha256))]).toEqual([undefined, text]);
    });
  });
}

export function contentBehaviour(entry: LedgerEntry): void {
  contentKeptWhole(entry);
  contentReadBack(entry);
}
