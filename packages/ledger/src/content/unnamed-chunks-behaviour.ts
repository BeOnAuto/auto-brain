import { randomUUIDv7, textToKeep } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { alpha, generated, run } from './content-samples.ts';
import { unnamedChunksLastMs } from './content-sweep.ts';

const UploadRows = Schema.Array(Schema.Struct({ upload_id: Schema.String }));

const anHourOld = '00000000-0000-7000-8000-000000000001';

interface Named {
  readonly kept: readonly string[];
  readonly staged: readonly string[];
}

interface Orphans {
  readonly fresh: string;
  readonly named: readonly string[];
}

async function uploadsIn(entry: LedgerEntry, database: string, table: string): Promise<readonly string[]> {
  const rows = await entry.queried(database, `SELECT DISTINCT upload_id FROM ${table} ORDER BY upload_id`);
  return Schema.decodeUnknownSync(UploadRows)(rows).map(({ upload_id }) => upload_id);
}

async function orphanedLike(entry: LedgerEntry, database: string, named: Named, upload: string): Promise<void> {
  await entry.queried(
    database,
    `INSERT INTO recorded_content_chunks (brain_key, upload_id, chunk, data)
      SELECT brain_key, '${upload}', chunk, data FROM recorded_content_chunks WHERE upload_id = '${named.kept.join()}'`,
  );
  await entry.queried(
    database,
    `INSERT INTO staged_content_chunks (brain_key, run_id, upload_id, chunk, data)
      SELECT brain_key, run_id, '${upload}', chunk, data FROM staged_content_chunks WHERE upload_id = '${named.staged.join()}'`,
  );
}

async function keptAndOrphaned(entry: LedgerEntry, database: string): Promise<Orphans> {
  const ledger = await aLedger(entry, database);
  await run(ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json')));
  await run(ledger.content.stage(alpha, 'run-1', (await generated(1000)).content()));
  const named = {
    kept: await uploadsIn(entry, database, 'recorded_content_chunks'),
    staged: await uploadsIn(entry, database, 'staged_content_chunks'),
  };
  const fresh = randomUUIDv7();
  await orphanedLike(entry, database, named, anHourOld);
  await orphanedLike(entry, database, named, fresh);
  return { fresh, named: [...named.kept, ...named.staged] };
}

async function uploadsLeft(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  return [
    ...(await uploadsIn(entry, database, 'recorded_content_chunks')),
    ...(await uploadsIn(entry, database, 'staged_content_chunks')),
  ].toSorted();
}

function sweptWhenOpened(entry: LedgerEntry): void {
  it('sweeps the chunks no head names once their upload is an hour old, when the ledger opens, and keeps every chunk a head names', async () => {
    const database = await entry.aDatabase();
    const { fresh, named } = await keptAndOrphaned(entry, database);

    await aLedger(entry, database);

    await vi.waitFor(async () => {
      expect(await uploadsLeft(entry, database)).toEqual([...named, fresh, fresh].toSorted());
    });
  });
}

function sweptBefore(entry: LedgerEntry): void {
  it('sweeps every chunk no head names whose upload began before the time it is given', async () => {
    const database = await entry.aDatabase();
    const { named } = await keptAndOrphaned(entry, database);
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());

    await store.sweepContent(Date.now() + unnamedChunksLastMs);

    expect(await uploadsLeft(entry, database)).toEqual(named.toSorted());
  });
}

export function unnamedChunksSwept(entry: LedgerEntry): void {
  describe('the chunks no head names', () => {
    sweptWhenOpened(entry);
    sweptBefore(entry);
  });
}
