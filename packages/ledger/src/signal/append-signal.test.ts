import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { dataAsWritten, emmettEventStore } from '../emmett/emmett-event-store.ts';
import { eventAppenderOf, streamAppends, streamSignalOf, VersionConflict } from '../index.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { happenings, noted } from '../testing/happenings.ts';
import { openLedgerWith, outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';

async function aStoreSignalling(appended: ReturnType<typeof streamSignalOf>) {
  const emmett = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => emmett.close());
  const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8, appended });
  await store.migrate();
  return store;
}

const one = [{ type: 'noted', data: { n: 1 } }];

describe('the signal an append raises', () => {
  it('names every stream appended to, after the append', async () => {
    const signal = streamSignalOf();
    const heard: string[] = [];
    signal.listen((brainKey) => {
      heard.push(brainKey);
    });
    const store = await aStoreSignalling(signal);

    await store.append('brain/acme/alpha/events/e1', one, 0);
    await store.append('org/acme/brains', one, 0);
    await store.append('brain/acme/Beta_2/runs/r1', one, 0);

    expect(heard).toEqual(['brain/acme/alpha/events/e1', 'org/acme/brains', 'brain/acme/Beta_2/runs/r1']);
  });

  it('is not raised by an append that met a version conflict, nor heard once a listener has stopped', async () => {
    const signal = streamSignalOf();
    const heard: string[] = [];
    const stop = signal.listen((brainKey) => {
      heard.push(brainKey);
    });
    const store = await aStoreSignalling(signal);
    await store.append('brain/acme/alpha/notes', one, 0);

    const conflicted = await outcomeOf(
      eventAppenderOf(store, tally.eventSchema)('brain/acme/alpha/notes', [{ type: 'counted', by: 1 }], 0),
    );
    stop();
    await store.append('brain/acme/alpha/notes', one, 1);

    expect([conflicted, heard]).toEqual([Result.fail(new VersionConflict()), ['brain/acme/alpha/notes']]);
  });

  it('is the signal of the process when none is given, so every ledger of the process raises it', async () => {
    const heard: string[] = [];
    const stop = streamAppends.listen((brainKey) => {
      heard.push(brainKey);
    });
    onTestFinished(stop);
    const { ledger, dispose } = await openLedgerWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);

    await Effect.runPromise(ledger.execute('brain/acme/gamma/notes', happenings, [noted('noted')]));

    expect(heard).toContain('brain/acme/gamma/notes');
  });
});
