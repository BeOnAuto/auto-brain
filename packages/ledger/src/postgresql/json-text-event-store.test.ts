import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../index.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { jsonTextEventStore, type EmmettStore } from './json-text-event-store.ts';

function anEmmettStore(): EmmettStore {
  const store = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => store.close());
  return store;
}

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const awkward = { zeta: 'a NUL \u0000 inside', a: { y: 'half a pair \uD800 alone', x: [1, null] } };

function counted(count: number): readonly { readonly type: 'counted'; readonly by: number }[] {
  return Array.from({ length: count }, () => ({ type: 'counted', by: 1 }));
}

const firstThree = [1, 2, 3].map((n) => ({ type: 'counted', data: { n } }));

describe('an event store that keeps each event as its JSON text, over an Emmett event store', () => {
  it('stores the JSON text of each event under json, and gives the event back exactly, keys in order', async () => {
    const emmett = anEmmettStore();
    const store = jsonTextEventStore(emmett);
    await store.migrate();

    await store.append(run, [{ type: 'noted', data: awkward }], 0);
    const read = await store.read(run);
    const stored = await emmett.readStream(run);

    expect(read).toEqual({ version: 1, events: [awkward] });
    expect(JSON.stringify(read.events)).toBe(JSON.stringify([awkward]));
    expect(
      stored.events.map(({ type, data }: { readonly type: string; readonly data: unknown }) => ({ type, data })),
    ).toEqual([{ type: 'noted', data: { json: JSON.stringify(awkward) } }]);
  });

  it('gives the events after a version, and that version when nothing follows it', async () => {
    const store = jsonTextEventStore(anEmmettStore());
    await store.migrate();
    await store.append(run, firstThree, 0);

    expect(await store.read(run, 1)).toEqual({ version: 3, events: [{ n: 2 }, { n: 3 }] });
    expect(await store.read(run, 3)).toEqual({ version: 3, events: [] });
  });

  it('takes up to 64 events in one append, and a decision of more is a defect', async () => {
    const store = jsonTextEventStore(anEmmettStore());
    await store.migrate();
    const append = eventAppenderOf(store);

    await expect(outcomeOf(append(run, tally.eventSchema, counted(65), 0))).rejects.toThrow(
      `A decision on ${run} gave 65 events, more than 64`,
    );
    expect(await outcomeOf(append(run, tally.eventSchema, counted(64), 0))).toMatchObject({ _tag: 'Success' });
    expect((await store.read(run)).version).toBe(64);
  });

  it('closes the store under it', async () => {
    const emmett = anEmmettStore();
    const store = jsonTextEventStore(emmett);
    await store.migrate();

    await store.close();

    await expect(emmett.readStream(run)).rejects.toThrow('Singleton connection pool has been closed');
  });
});
