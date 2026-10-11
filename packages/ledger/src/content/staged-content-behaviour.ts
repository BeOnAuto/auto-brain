import { mostContentChunkBytes } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { alpha, beta, generated, octets, readBack, run, unread } from './content-samples.ts';

const StagedRows = Schema.Array(Schema.Struct({ run_id: Schema.String, count: Schema.Number }));

function rowsOfEachBuild(entry: LedgerEntry, database: string) {
  return Promise.all(
    ['staged_content_chunks', 'staged_content'].map(async (table) =>
      Schema.decodeUnknownSync(StagedRows)(
        await entry.queried(
          database,
          `SELECT run_id, CAST(count(*) AS INTEGER) AS count FROM ${table} GROUP BY run_id ORDER BY run_id`,
        ),
      ),
    ),
  );
}

export function contentStaged(entry: LedgerEntry): void {
  describe('the content staged under a build', () => {
    it('reads back on another connection under its brain and build alone, until the build is unstaged', async () => {
      const database = await entry.aDatabase();
      const writing = await aLedger(entry, database);
      const reading = await aLedger(entry, database);
      const { sha256, content } = await generated(2_500_000);

      await run(writing.content.stage(alpha, 'run-1', sha256, content()));
      await run(writing.content.stage(alpha, 'run-1', sha256, unread(2_500_000).content));
      await run(writing.content.stage(alpha, 'run-2', sha256, content()));
      const before = [
        await readBack(await run(reading.content.staged(alpha, 'run-1', sha256))),
        await readBack(await run(reading.content.staged(beta, 'run-1', sha256))),
        await readBack(await run(reading.content.staged(alpha, 'run-3', sha256))),
        await readBack(await run(reading.content.get(alpha, sha256))),
      ];
      await run(writing.content.unstage(alpha, 'run-1'));
      const after = [
        await readBack(await run(reading.content.staged(alpha, 'run-1', sha256))),
        await readBack(await run(reading.content.staged(alpha, 'run-2', sha256))),
      ];

      const staged = {
        bytes: 2_500_000,
        sha256,
        largestPiece: mostContentChunkBytes,
        mediaType: octets,
        declared: 2_500_000,
      };
      expect(before).toEqual([staged, undefined, undefined, undefined]);
      expect(after).toEqual([undefined, staged]);
      expect(await rowsOfEachBuild(entry, database)).toEqual([
        [{ run_id: 'run-2', count: 3 }],
        [{ run_id: 'run-2', count: 1 }],
      ]);
    });
  });
}

const oldShapes: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a chunk that keeps text',
    'CREATE TABLE recorded_content_chunks (brain_key TEXT NOT NULL, sha256 TEXT NOT NULL, chunk INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (brain_key, sha256, chunk))',
    'recorded_content_chunks has the columns brain_key, chunk, sha256, text, where this server keeps brain_key, chunk, data, sha256',
  ],
  [
    'a head without a media type',
    'CREATE TABLE recorded_content_heads (brain_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes BIGINT NOT NULL, chunks INTEGER NOT NULL, PRIMARY KEY (brain_key, sha256))',
    'recorded_content_heads has the columns brain_key, bytes, chunks, sha256, where this server keeps brain_key, bytes, chunks, media_type, sha256',
  ],
];

export function contentOfAnOlderShape(entry: LedgerEntry): void {
  describe('a database whose recorded content has an older shape', () => {
    it.each(oldShapes)(
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
