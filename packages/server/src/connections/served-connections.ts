import type { AppRuntime } from '@on.auto/api';
import { makeConnectionOperations, type ConnectionOperations, type RuntimeAccess } from '@on.auto/connections';
import { studioOrigin } from '@on.auto/identity';
import type { SecretStore } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import type { DatabaseSettings } from '@on.auto/workflow-host';

import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import { modelProvidersOf } from '../function-settings/reasoning-settings.ts';
import type { Settings } from '../settings/settings.ts';

export interface StoresAndConnections {
  readonly stores: LedgerStores;
  readonly connections: ConnectionOperations;
}

type ServingSettings = Pick<Settings, 'connections' | 'toolServers' | 'models' | 'signIn' | 'apiKeys'>;

function accessOf({ signIn, apiKeys }: ServingSettings): RuntimeAccess {
  if (signIn !== undefined) {
    return 'people';
  }
  return apiKeys === undefined ? 'local' : 'keys';
}

function connectionsServedBy(
  settings: ServingSettings,
  secrets: SecretStore,
  ownOrigin: () => string,
): ConnectionOperations {
  const { signIn } = settings;
  return makeConnectionOperations({
    secrets,
    policy: settings.connections,
    fileEntries: settings.toolServers.servers.map(({ name }) => name),
    providers: modelProvidersOf(settings.models),
    pages: { studio: studioOrigin, runtime: () => signIn?.publicUrl ?? ownOrigin() },
    access: accessOf(settings),
  });
}

export async function storesAndConnectionsOf(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  database: DatabaseSettings,
  ownOrigin: () => string,
): Promise<StoresAndConnections> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
  return { stores, connections: connectionsServedBy(settings, stores.secrets, ownOrigin) };
}
