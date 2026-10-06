import { Ledger } from '@beonauto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StreamStore } from '../event-store.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { happenings, noted } from '../testing/happenings.ts';
import { appendSignal, brainKeyOfStream, signalledOn } from './append-signal.ts';

function failingStore(): StreamStore {
  return {
    mostEventsInOneAppend: 8,
    read: () => Promise.resolve({ version: 0, events: [], lineages: [] }),
    append: () => Promise.reject(new Error('The database is gone')),
    migrate: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

describe('the signal of an append to a brain', () => {
  it('is raised with the brain once the append is recorded, and not for a stream of no brain', async () => {
    const appends = appendSignal();
    const runtime = ManagedRuntime.make(ledgerLayer({ fileName: ':memory:', appends }));
    const ledger = await runtime.runPromise(Ledger);
    const heard: string[] = [];
    const versionsSeen: Promise<number>[] = [];
    appends.listen((brainKey) => {
      heard.push(brainKey);
      versionsSeen.push(
        Effect.runPromise(Effect.map(ledger.load('brain/acme/alpha/notes', happenings), ({ version }) => version)),
      );
    });

    await Effect.runPromise(ledger.execute('brain/acme/alpha/notes', happenings, [noted('noted', 1)]));
    await Effect.runPromise(ledger.execute('org/acme/brains', happenings, [noted('noted', 2)]));
    const seen = await Promise.all(versionsSeen);
    await runtime.dispose();

    expect([heard, seen]).toEqual([['brain/acme/alpha/'], [1]]);
  });

  it('is not raised for an append that failed, and no longer reaches a listener that stopped listening', async () => {
    const appends = appendSignal();
    const heard: string[] = [];
    const stop = appends.listen((brainKey) => {
      heard.push(brainKey);
    });

    const failed = await signalledOn(failingStore(), appends).append('brain/acme/alpha/notes', [], 0).catch(String);
    appends.raise('brain/acme/alpha/notes');
    stop();
    appends.raise('brain/acme/beta/notes');

    expect([failed, heard]).toEqual(['Error: The database is gone', ['brain/acme/alpha/']]);
  });

  it('names a brain by its stream through the third slash, and leaves a store without a signal as it is', () => {
    const store = failingStore();

    expect([
      brainKeyOfStream('brain/acme/alpha/executions/run-1'),
      brainKeyOfStream('brain/acme/alpha'),
      signalledOn(store) === store,
    ]).toEqual(['brain/acme/alpha/', undefined, true]);
  });
});
