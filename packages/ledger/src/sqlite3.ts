import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Ledger, RunOutcomeMapping } from '@beonauto/operations';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { Layer } from 'effect';

import { sqliteLedgerLayer } from './sqlite-event-store.ts';

export interface LedgerOptions {
  readonly fileName: string;
  readonly runOutcomes?: RunOutcomeMapping;
}

const pageCacheOfEightMebibytes = -8192;

const modestConnections = { pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 } };

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

export function ledgerLayer({ fileName, runOutcomes }: LedgerOptions): Layer.Layer<Ledger> {
  return sqliteLedgerLayer(() => {
    prepareDirectoryOf(fileName);
    return { driver: sqlite3EventStoreDriver, fileName, connectionOptions: modestConnections };
  }, runOutcomes);
}
