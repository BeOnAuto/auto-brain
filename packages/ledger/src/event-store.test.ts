import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { sqliteEventStore, type EventStore } from './index.ts';

const opened: EventStore[] = [];

async function aStore(): Promise<EventStore> {
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName: ':memory:' }));
  opened.push(store);
  await store.migrate();
  return store;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
});

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function numbered(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ type: 'counted', data: { n: from + index } }));
}

describe('reading a stream after a version', () => {
  it('gives the events after that version, and the version of the whole stream', async () => {
    const store = await aStore();
    await store.append(run, numbered(1, 3), 0);
    await store.append(run, numbered(4, 2), 3);

    expect(await store.read(run, 3)).toEqual({ version: 5, events: [{ n: 4 }, { n: 5 }] });
    expect(await store.read(run)).toEqual({ version: 5, events: [1, 2, 3, 4, 5].map((n) => ({ n })) });
  });

  it('gives no events and the version it was asked after when nothing follows it', async () => {
    const store = await aStore();
    await store.append(run, numbered(1, 3), 0);

    expect(await store.read(run, 3)).toEqual({ version: 3, events: [] });
    expect(await store.read('run/nobody-wrote', 0)).toEqual({ version: 0, events: [] });
  });
});
