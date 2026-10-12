import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import type { AppendSignal } from '@on.auto/ledger';
import { postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { ContentStore, Ledger } from '@on.auto/operations';
import { Effect, Layer, Redacted } from 'effect';

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
  settings: Pick<Settings, 'ledger' | 'content' | 'proxy'>,
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  const content = contentStoreOf(settings);
  return content === undefined
    ? ledgerLayerOf(settings.ledger, appends)
    : Layer.unwrap(Effect.as(content.reached, ledgerLayerOf(settings.ledger, appends, content.store)));
}
