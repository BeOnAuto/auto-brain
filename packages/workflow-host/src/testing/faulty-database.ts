import { Effect } from 'effect';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface FaultyDatabase extends HostDatabase {
  readonly failing: (fails: boolean) => void;
}

export function faultyDatabase(database: HostDatabase): FaultyDatabase {
  const faults = { failing: false };
  const failed = Effect.fail(new DatabaseFailed({ detail: 'The database was told to fail' }));
  return {
    ...database,
    read: (statement) => (faults.failing ? failed : database.read(statement)),
    write: (statement) => (faults.failing ? failed : database.write(statement)),
    failing: (fails) => {
      faults.failing = fails;
    },
  };
}
