import { dumbo } from '@event-driven-io/dumbo';
import { Effect } from 'effect';

import { sqliteEventStore, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { keyringOf, type SecretKeys } from './secret-keys.ts';
import { secretStoreOn, type SecretStore } from './secret-store.ts';

export interface SecretStoreOptions {
  readonly fileName: string;
  readonly keys: SecretKeys;
}

export function sqliteSecretStoreOn<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  keys: SecretKeys,
): Effect.Effect<SecretStore> {
  return Effect.promise(async () => {
    const keyring = keyringOf(keys);
    const options = optionsOf();
    const pool = dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
    const store = sqliteEventStore(() => ({ ...options, pool }));
    await store.migrate();
    return secretStoreOn(pool.execute, keyring, () => store.close());
  });
}
