import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import type { AppendSignal } from '@on.auto/ledger';
import { postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { ContentStore, Ledger } from '@on.auto/operations';
import { predictionBuilds, predictionModels } from '@on.auto/prediction';
import { Effect, Layer, Redacted } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';

const projections = [openRequests, conversations, predictionBuilds, predictionModels];

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
  settings: ContentStoreSettings & { readonly ledger: LedgerSettings },
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  const content = contentStoreOf(settings);
  return content === undefined
    ? ledgerLayerOf(settings.ledger, appends)
    : Layer.unwrap(Effect.as(content.reached, ledgerLayerOf(settings.ledger, appends, content.store)));
}
