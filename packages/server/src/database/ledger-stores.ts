import type { SecretKeys, SecretStore } from '@on.auto/ledger';
import { postgresqlSecretStore } from '@on.auto/ledger/postgresql';
import { sqliteSecretStore } from '@on.auto/ledger/sqlite3';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Effect, type Context, type Redacted } from 'effect';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logContentStore, logLedger, logSecretStore } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';
import { retryStateKeyOf, secretsKeysOf } from './secrets-keys.ts';

export interface LedgerStores {
  readonly secrets: SecretStore;
  readonly retryStateKey: Redacted.Redacted<Uint8Array>;
  readonly withSecretsClosed: (served: Served) => Served;
}

function secretStoreOn(database: DatabaseSettings, keys: SecretKeys): Effect.Effect<SecretStore> {
  return database.store === 'postgresql'
    ? postgresqlSecretStore({ pools: database.pools, keys })
    : sqliteSecretStore({ fileName: database.file, keys });
}

function openedAndRotated(database: DatabaseSettings, keys: SecretKeys): Effect.Effect<SecretStore> {
  return Effect.gen(function* () {
    const secrets = yield* secretStoreOn(database, keys);
    const resealed = yield* secrets.rotated();
    yield* logSecretStore({ kid: secrets.kid, resealed });
    return secrets;
  });
}

export async function ledgerStoresOpenedBy(
  context: Context.Context<never>,
  { ledger, content, secrets }: Pick<Settings, 'ledger' | 'content' | 'secrets'>,
  database: DatabaseSettings,
): Promise<LedgerStores> {
  const run = Effect.runPromiseWith(context);
  await run(Effect.andThen(logLedger(ledger), logContentStore(content)));
  const keys = secretsKeysOf(secrets);
  const store = await run(openedAndRotated(database, keys));
  return {
    secrets: store,
    retryStateKey: retryStateKeyOf(keys),
    withSecretsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await store.close();
      },
    }),
  };
}
