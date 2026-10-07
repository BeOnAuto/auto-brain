import { openRequests } from '@beonauto/interaction';
import type { AppendSignal } from '@beonauto/ledger';
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import type { Ledger } from '@beonauto/operations';
import { runOutcomeMapping } from '@beonauto/specs';
import { Redacted, type Layer } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';

const projections = [openRequests];

export function ledgerLayerOf(settings: LedgerSettings, appends?: AppendSignal): Layer.Layer<Ledger> {
  const signalled = appends === undefined ? {} : { appends };
  return settings.store === 'postgresql'
    ? postgresqlLedgerLayer({
        connectionString: Redacted.value(settings.url),
        runOutcomes: runOutcomeMapping,
        projections,
        ...signalled,
      })
    : ledgerLayer({ fileName: settings.file, runOutcomes: runOutcomeMapping, projections, ...signalled });
}
