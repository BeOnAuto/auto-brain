import type { HostDatabase } from '../database/host-database.ts';

export interface CountingDatabase {
  readonly database: HostDatabase;
  readonly reads: () => number;
  readonly failingDiscovery: (fails: boolean) => void;
}

export function countingDatabase(database: HostDatabase): CountingDatabase {
  const counted = { reads: 0, failingDiscovery: false };
  const { store } = database;
  return {
    database: {
      ...database,
      store: {
        ...store,
        readRecorded: (brainKey, selection, page) => {
          counted.reads += 1;
          return store.readRecorded(brainKey, selection, page);
        },
        definitionStreams: (definitionType) =>
          counted.failingDiscovery
            ? Promise.reject(new Error('The store was told to fail'))
            : store.definitionStreams(definitionType),
      },
    },
    reads: () => counted.reads,
    failingDiscovery: (fails) => {
      counted.failingDiscovery = fails;
    },
  };
}
