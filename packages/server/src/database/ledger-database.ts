import type { AppendObserver } from '@on.auto/ledger';
import type { DatabaseSettings } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { databasePoolsOf } from './database-pools.ts';

export function ledgerDatabaseOf(
  { ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>,
  observer?: AppendObserver,
): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file, observer }
    : { store: 'postgresql', pools: databasePoolsOf(ledger, proxy), observer };
}
