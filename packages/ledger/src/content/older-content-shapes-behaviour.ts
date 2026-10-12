import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const olderShapes: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a chunk that keeps text',
    'CREATE TABLE recorded_content_chunks (brain_key TEXT NOT NULL, sha256 TEXT NOT NULL, chunk INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (brain_key, sha256, chunk))',
    'recorded_content_chunks has the columns brain_key, chunk, sha256, text, where this server keeps brain_key, chunk, data, upload_id',
  ],
  [
    'a head without a media type',
    'CREATE TABLE recorded_content_heads (brain_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes BIGINT NOT NULL, chunks INTEGER NOT NULL, PRIMARY KEY (brain_key, sha256))',
    'recorded_content_heads has the columns brain_key, bytes, chunks, sha256, where this server keeps brain_key, bytes, chunks, media_type, sha256, upload_id',
  ],
];

export function contentOfAnOlderShape(entry: LedgerEntry): void {
  describe('a database whose recorded content has an older shape', () => {
    it.each(olderShapes)(
      'is refused when the ledger opens, for %s, with words that say to delete it',
      async (_shape, table, found) => {
        const database = await entry.aDatabase();
        await entry.queried(database, table);

        await expect(aLedger(entry, database)).rejects.toThrow(
          `The ledger's database keeps recorded content in a shape this server no longer reads: ${found}. Nothing stored before launch is carried over, so delete the local database and start the server again`,
        );
      },
    );
  });
}
