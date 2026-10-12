import { mostContentChunkBytes } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  alpha,
  beta,
  deliveredBeforeFailing,
  generated,
  generatedStream,
  octets,
  present,
  readBack,
  refusalOf,
  run,
  unread,
} from './content-samples.ts';

const StagedRows = Schema.Array(Schema.Struct({ run_id: Schema.String, count: Schema.Number }));

function rowsOfEachRun(entry: LedgerEntry, database: string) {
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

function unstagingWhileRead(unstage: () => Promise<void>, bytes: number): ReadableStream<Uint8Array> {
  const source = generatedStream(bytes, 7).getReader();
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      pulls += 1;
      if (pulls === 20) {
        await unstage();
      }
      const { done, value } = await source.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
  });
}

function stagedAndUnstaged(entry: LedgerEntry): void {
  it('reads back on another connection under its playbook and run alone, until the run is unstaged', async () => {
    const database = await entry.aDatabase();
    const writing = await aLedger(entry, database);
    const reading = await aLedger(entry, database);
    const { sha256, content } = await generated(2_500_000);

    const kept = await run(writing.content.stage(alpha, 'run-1', content()));
    await run(writing.content.stage(alpha, 'run-1', content()));
    await run(writing.content.stage(alpha, 'run-2', content()));
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
    expect(kept).toEqual({ sha256, bytes: 2_500_000, mediaType: octets });
    expect([before, after]).toEqual([
      [staged, undefined, undefined, undefined],
      [undefined, staged],
    ]);
    expect(await rowsOfEachRun(entry, database)).toEqual([
      [{ run_id: 'run-2', count: 3 }],
      [{ run_id: 'run-2', count: 1 }],
    ]);
  });
}

function stagedAfterUnstaging(entry: LedgerEntry): void {
  it('refuses a stage under a run once unstaged, leaving its stream unread, and keeps nothing of a stage the unstage raced', async () => {
    const database = await entry.aDatabase();
    const staging = await aLedger(entry, database);
    const unstaging = await aLedger(entry, database);
    await run(unstaging.content.unstage(alpha, 'run-1'));
    const late = unread();

    const refused = await Promise.all([
      refusalOf(staging.content.stage(alpha, 'run-1', late.content)),
      refusalOf(
        staging.content.stage(alpha, 'run-2', {
          stream: unstagingWhileRead(() => run(unstaging.content.unstage(alpha, 'run-2')), 2_500_000),
          mediaType: octets,
        }),
      ),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'staging_ended',
        detail: 'Nothing more is staged under run run-1, since what it staged was removed',
      }),
      expect.objectContaining({ _tag: 'staging_ended', run: 'run-2' }),
    ]);
    expect(late.cancelled()).toBe(true);
    expect(await rowsOfEachRun(entry, database)).toEqual([[], []]);
  });
}

function readWhileUnstaged(entry: LedgerEntry): void {
  it('fails a read of a staged content whose run is unstaged while it is read, in words that say so', async () => {
    const ledger = await aLedger(entry);
    const { sha256, content } = await generated(2_500_000);
    await run(ledger.content.stage(alpha, 'run-1', content()));

    const staged = await present(ledger.content.staged(alpha, 'run-1', sha256));
    await run(ledger.content.unstage(alpha, 'run-1'));
    const { bytes, failure } = await deliveredBeforeFailing(staged);

    expect([0, mostContentChunkBytes]).toContain(bytes);
    expect(failure).toEqual(
      new Error(
        `The content staged under ${sha256} has no chunk ${bytes / mostContentChunkBytes}, as when its run is unstaged while it is read`,
      ),
    );
  });
}

export function contentStaged(entry: LedgerEntry): void {
  describe('the content staged under a run', () => {
    stagedAndUnstaged(entry);
    stagedAfterUnstaging(entry);
    readWhileUnstaged(entry);
  });
}
