import { Effect } from 'effect';

import { executorOn } from '../content/postgresql-content.ts';
import { lostConnectionsLoggedWith } from '../postgresql/lost-connections.ts';
import type { PoolBounds } from '../postgresql/postgresql-event-store.ts';
import { keyringOf, type SecretKeys } from './secret-keys.ts';
import { secretStoreOn, type SecretStore } from './secret-store.ts';

export interface SecretConnections {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  on(event: 'error', listener: (error: Readonly<Error>) => void): unknown;
  end(): Promise<void>;
}

export interface PostgreSQLSecretStoreOptions {
  readonly pools: (bounds: PoolBounds) => SecretConnections;
  readonly keys: SecretKeys;
}

const connectionsOfTheSecretStore = 2;

export function postgresqlSecretStore({ pools, keys }: PostgreSQLSecretStoreOptions): Effect.Effect<SecretStore> {
  return Effect.map(Effect.context(), (context) => {
    const keyring = keyringOf(keys);
    const connections = pools({ max: connectionsOfTheSecretStore });
    connections.on('error', lostConnectionsLoggedWith(context));
    return secretStoreOn(executorOn(connections), keyring, () => connections.end());
  });
}
