import { runOutcomeMapping } from '@on.auto/definitions';
import { conversations, openRequests } from '@on.auto/interaction';
import type { AppendSignal } from '@on.auto/ledger';
import { postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { ContentStore, Ledger } from '@on.auto/operations';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Effect, Layer } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { contentStoreOf } from './content-store.ts';

const projections = [openRequests, conversations];

export function ledgerLayerOf(
  database: DatabaseSettings,
  appends?: AppendSignal,
  content?: ContentStore,
): Layer.Layer<Ledger> {
  const signalled = { ...(appends === undefined ? {} : { appends }), ...(content === undefined ? {} : { content }) };
  return database.store === 'postgresql'
    ? postgresqlLedgerLayer({ pools: database.pools, runOutcomes: runOutcomeMapping, projections, ...signalled })
    : ledgerLayer({ fileName: database.file, runOutcomes: runOutcomeMapping, projections, ...signalled });
}

export function ledgerLayerFor(
  settings: Pick<Settings, 'content' | 'proxy'>,
  database: DatabaseSettings,
  appends?: AppendSignal,
): Layer.Layer<Ledger> {
  const content = contentStoreOf(settings);
  return content === undefined
    ? ledgerLayerOf(database, appends)
    : Layer.unwrap(Effect.as(content.reached, ledgerLayerOf(database, appends, content.store)));
}
