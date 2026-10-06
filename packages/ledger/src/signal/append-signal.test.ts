import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { dataAsWritten, emmettEventStore } from '../emmett/emmett-event-store.ts';
import { appendSignalOf, brainAppends, brainKeyOfStream, eventAppenderOf, VersionConflict } from '../index.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { happenings, noted } from '../testing/happenings.ts';
import { openLedgerWith, outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';

async function aStoreSignalling(appended: ReturnType<typeof appendSignalOf>) {
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
  it('names the brain of every stream appended to, after the append, and nothing for a stream of no brain', async () => {
    const signal = appendSignalOf();
    const heard: string[] = [];
    signal.listen((brainKey) => {
      heard.push(brainKey);
    });
    const store = await aStoreSignalling(signal);

    await store.append('brain/acme/alpha/events/e1', one, 0);
    await store.append('org/acme/brains', one, 0);
    await store.append('brain/acme/Beta_2/runs/r1', one, 0);

    expect(heard).toEqual(['brain/acme/alpha/', 'brain/acme/Beta_2/']);
  });

  it('is not raised by an append that met a version conflict, nor heard once a listener has stopped', async () => {
    const signal = appendSignalOf();
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

    expect([conflicted, heard]).toEqual([Result.fail(new VersionConflict()), ['brain/acme/alpha/']]);
  });

  it('is the signal of the process when none is given, so every ledger of the process raises it', async () => {
    const heard: string[] = [];
    const stop = brainAppends.listen((brainKey) => {
      heard.push(brainKey);
    });
    onTestFinished(stop);
    const { ledger, dispose } = await openLedgerWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);

    await Effect.runPromise(ledger.execute('brain/acme/gamma/notes', happenings, [noted('noted')]));

    expect(heard).toContain('brain/acme/gamma/');
  });
});

describe('the brain key of a stream', () => {
  it('is its name through the third slash, for a stream of a brain alone', () => {
    expect(
      ['brain/acme/alpha/specs/inference', 'brain/acme/alpha', 'org/acme/brains', 'brains/acme/alpha/x'].map((stream) =>
        brainKeyOfStream(stream),
      ),
    ).toEqual(['brain/acme/alpha/', undefined, undefined, undefined]);
  });
});
