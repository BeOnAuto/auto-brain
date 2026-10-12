import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const olderShapes: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a chunk that keeps text',
    'CREATE TABLE recorded_content_chunks (playbook_key TEXT NOT NULL, sha256 TEXT NOT NULL, chunk INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (playbook_key, sha256, chunk))',
    'recorded_content_chunks has the columns chunk, playbook_key, sha256, text, where this server keeps chunk, data, playbook_key, upload_id',
  ],
  [
    'a head without a media type',
    'CREATE TABLE recorded_content_heads (playbook_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes BIGINT NOT NULL, chunks INTEGER NOT NULL, PRIMARY KEY (playbook_key, sha256))',
    'recorded_content_heads has the columns bytes, chunks, playbook_key, sha256, where this server keeps bytes, chunks, media_type, playbook_key, sha256, upload_id',
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
