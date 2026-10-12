import { runOutcomeMapping } from '@beonauto/definitions';
import { conversations, openRequests } from '@beonauto/interaction';
import type { AppendSignal, ContentStore } from '@beonauto/ledger';
import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import type { Ledger } from '@beonauto/operations';
import { Redacted, type Layer } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { contentStoreOf } from './content-store.ts';

const projections = [openRequests, conversations];

export function ledgerLayerOf(
  settings: LedgerSettings,
  appends?: AppendSignal,
  content?: ContentStore,
): Layer.Layer<Ledger> {
  const signalled = { ...(appends === undefined ? {} : { appends }), ...(content === undefined ? {} : { content }) };
  return settings.store === 'postgresql'
    ? postgresqlLedgerLayer({
        connectionString: Redacted.value(settings.url),
        runOutcomes: runOutcomeMapping,
        projections,
        ...signalled,
      })
    : ledgerLayer({ fileName: settings.file, runOutcomes: runOutcomeMapping, projections, ...signalled });
}

export function ledgerLayerFor(
  settings: Pick<Settings, 'ledger' | 'content' | 'models'>,
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  return ledgerLayerOf(settings.ledger, appends, contentStoreOf(settings));
}
