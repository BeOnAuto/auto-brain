import { connectionsFold, connectionsStreamOfOrg } from '@on.auto/connections';
import { ledgerLayer, sqliteSecretStore } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime, Redacted } from 'effect';

export const secretsKey = Buffer.alloc(32, 7);

export async function secretIdOf(fileName: string, org: string, connection: string): Promise<string | undefined> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  const { state } = await runtime.runPromise(
    Effect.flatMap(Ledger, (ledger) => ledger.load(connectionsStreamOfOrg(org), connectionsFold)),
  );
  await runtime.dispose();
  return state.get(connection)?.secretId;
}

export async function keptValueOf(fileName: string, id: string): Promise<string | undefined> {
  const store = await Effect.runPromise(
    sqliteSecretStore({ fileName, keys: { current: Redacted.make(Uint8Array.from(secretsKey)) } }),
  );
  const value = await Effect.runPromise(store.read(id));
  await store.close();
  return value === undefined ? undefined : Redacted.value(value);
}
