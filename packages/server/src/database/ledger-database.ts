import type { DatabaseSettings } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { databasePoolsOf } from './database-pools.ts';

export function ledgerDatabaseOf({ ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file }
    : { store: 'postgresql', pools: databasePoolsOf(ledger, proxy) };
}
