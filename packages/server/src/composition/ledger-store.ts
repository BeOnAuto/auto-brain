import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import type { AppendSignal } from '@on.auto/ledger';
import { postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { ContentStore, Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { databasePoolsOf } from '../database/database-pools.ts';
import type { Settings } from '../settings/settings.ts';
import { contentStoreOf } from './content-store.ts';

const projections = [openRequests, conversations];

export function ledgerLayerOf(
  { ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>,
  appends?: AppendSignal,
  content?: ContentStore,
): Layer.Layer<Ledger> {
  const signalled = { ...(appends === undefined ? {} : { appends }), ...(content === undefined ? {} : { content }) };
  return ledger.store === 'postgresql'
    ? postgresqlLedgerLayer({
        pools: databasePoolsOf(ledger, proxy),
        runOutcomes: runOutcomeMapping,
        projections,
        ...signalled,
      })
    : ledgerLayer({ fileName: ledger.file, runOutcomes: runOutcomeMapping, projections, ...signalled });
}

export function ledgerLayerFor(
  settings: Pick<Settings, 'ledger' | 'content' | 'proxy'>,
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  const content = contentStoreOf(settings);
  return content === undefined
    ? ledgerLayerOf(settings, appends)
    : Layer.unwrap(Effect.as(content.reached, ledgerLayerOf(settings, appends, content.store)));
}
