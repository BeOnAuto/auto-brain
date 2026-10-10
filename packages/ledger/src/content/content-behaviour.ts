import { createHash } from 'node:crypto';

import { bytesOfText, mostContentChunkBytes, type BrainAddress, type Ledger } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const alpha: BrainAddress = { org: 'acme', brain: 'alpha' };

const beta = { org: 'acme', brain: 'beta' };

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

function kept(ledger: Ledger['Service'], text: string, brain: BrainAddress = alpha): Promise<string> {
  const sha256 = digestOf(text);
  return Effect.runPromise(ledger.content.put(brain, sha256, text)).then(() => sha256);
}

export function contentBehaviour(entry: LedgerEntry): void {
  describe('the content a brain recorded', () => {
    it.each([
      ['100 bytes', 100],
      ['64 KiB', 65_536],
      ['5 MB', 5_000_000],
    ])(
      'keeps an answer of %s whole, in chunks of at most 1 MiB cut at a code point, and joins them back exactly',
      async (_size, bytes) => {
        const database = await entry.aDatabase();
        const ledger = await aLedger(entry, database);
        const text = answerOfAbout(bytes);

        const sha256 = await kept(ledger, text);
        const chunks = Schema.decodeUnknownSync(ChunkRows)(
          await entry.queried(
            database,
            `SELECT chunk, octet_length(text) AS bytes FROM recorded_content_chunks WHERE sha256 = '${sha256}' ORDER BY chunk`,
          ),
        );

        expect(await Effect.runPromise(ledger.content.get(alpha, sha256))).toBe(text);
        expect(chunks.map(({ chunk }) => chunk)).toEqual(chunks.map((_chunk, index) => index));
        expect(chunks.length).toBeGreaterThanOrEqual(Math.ceil(bytesOfText(text) / mostContentChunkBytes));
        expect(chunks.every((chunk) => chunk.bytes <= mostContentChunkBytes)).toBe(true);
      },
    );

    it('keeps an answer received twice once, and reads it in its own brain alone', async () => {
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
