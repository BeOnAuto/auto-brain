import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import type { Ledger } from '@beonauto/operations';
import { Redacted, type Layer } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';

export function ledgerLayerOf(settings: LedgerSettings): Layer.Layer<Ledger> {
  return settings.store === 'postgresql'
    ? postgresqlLedgerLayer({ connectionString: Redacted.value(settings.url) })
    : ledgerLayer({ fileName: settings.file });
}
