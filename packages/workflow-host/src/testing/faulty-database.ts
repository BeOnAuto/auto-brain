import { Effect } from 'effect';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface FaultyDatabase extends HostDatabase {
  readonly failing: (fails: boolean) => void;
  readonly failingWrites: (fails: boolean) => void;
}

export function faultyDatabase(database: HostDatabase): FaultyDatabase {
  const faults = { failing: false, failingWrites: false };
  const failed = Effect.fail(new DatabaseFailed({ detail: 'The database was told to fail' }));
  return {
    ...database,
    read: (statement) => Effect.suspend(() => (faults.failing ? failed : database.read(statement))),
    write: (statement) =>
      Effect.suspend(() => (faults.failing || faults.failingWrites ? failed : database.write(statement))),
    failing: (fails) => {
      faults.failing = fails;
    },
    failingWrites: (fails) => {
      faults.failingWrites = fails;
    },
  };
}
