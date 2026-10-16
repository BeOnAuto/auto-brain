import { SQL } from '@event-driven-io/dumbo';
import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { sealedSecrets } from './sealed-secrets.ts';
import { kidOfSealed, sealedUnder, unsealedWith } from './sealing.ts';
import { secretKeyUnknown, type SecretKeyUnknown } from './secret-key-unknown.ts';
import type { Keyring, SealingKey } from './secret-keys.ts';
import { SecretRefused } from './secret-refused.ts';

const mostSecretBytes = 8192;

const rowsInABatch = 100;

export interface SecretStore {
  readonly kid: string;
  readonly keep: (value: Redacted.Redacted) => Effect.Effect<string, SecretRefused>;
  readonly read: (id: string) => Effect.Effect<Redacted.Redacted | undefined, SecretKeyUnknown>;
  readonly forget: (id: string) => Effect.Effect<void>;
  readonly rotated: () => Effect.Effect<number>;
  readonly close: () => Promise<void>;
}

interface Rotation {
  readonly current: SealingKey;
  readonly previous: SealingKey;
}

const SealedRows = Schema.Array(Schema.Struct({ sealed: Schema.String }));

const PreviouslySealedRows = Schema.Array(Schema.Struct({ id: Schema.String, sealed: Schema.String }));

function refusalOf(value: string): SecretRefused | undefined {
  if (value === '') {
    return new SecretRefused({ because: 'empty', detail: 'A secret to keep is empty' });
  }
  return Buffer.byteLength(value) > mostSecretBytes
    ? new SecretRefused({
        because: 'too_large',
        detail: `A secret to keep holds more than ${mostSecretBytes / 1024} KiB`,
      })
    : undefined;
}

function queried(execute: StatementExecutor, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.query(sql)).rows);
}

function commanded(execute: StatementExecutor, sql: SQL): Effect.Effect<void> {
  return Effect.asVoid(Effect.promise(() => execute.command(sql)));
}

function keptUnder(execute: StatementExecutor, key: SealingKey, value: string): Effect.Effect<string> {
  return Effect.gen(function* () {
    const id = randomUUIDv7();
    const sealed = yield* Effect.promise(() => sealedUnder(key, value));
    yield* commanded(
      execute,
      SQL`INSERT INTO ${sealedSecrets} (id, kid, sealed, kept_at)
        VALUES (${id}, ${key.kid}, ${sealed}, ${new Date().toISOString()})`,
    );
    return id;
  });
}

function unsealed(keyring: Keyring, sealed: string): Effect.Effect<string, SecretKeyUnknown> {
  return Effect.suspend(() => {
    const kid = kidOfSealed(sealed);
    const key = keyring.named(kid);
    return key === undefined ? Effect.fail(secretKeyUnknown(kid)) : Effect.promise(() => unsealedWith(key, sealed));
  });
}

function readOn(
  execute: StatementExecutor,
  keyring: Keyring,
  id: string,
): Effect.Effect<Redacted.Redacted | undefined, SecretKeyUnknown> {
  return Effect.flatMap(queried(execute, SQL`SELECT sealed FROM ${sealedSecrets} WHERE id = ${id}`), (rows) => {
    const row = Schema.decodeUnknownSync(SealedRows)(rows).at(0);
    return row === undefined
      ? Effect.undefined
      : Effect.map(unsealed(keyring, row.sealed), (value) => Redacted.make(value));
  });
}

function resealedRow(
  execute: StatementExecutor,
  { current, previous }: Rotation,
  { id, sealed }: { readonly id: string; readonly sealed: string },
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const value = yield* Effect.promise(() => unsealedWith(previous, sealed));
    const resealed = yield* Effect.promise(() => sealedUnder(current, value));
    const updated = yield* queried(
      execute,
      SQL`UPDATE ${sealedSecrets} SET kid = ${current.kid}, sealed = ${resealed}
        WHERE id = ${id} AND kid = ${previous.kid} RETURNING id`,
    );
    return updated.length;
  });
}

function resealedInBatches(execute: StatementExecutor, rotation: Rotation, before: number): Effect.Effect<number> {
  return Effect.gen(function* () {
    const rows = Schema.decodeUnknownSync(PreviouslySealedRows)(
      yield* queried(
        execute,
        SQL`SELECT id, sealed FROM ${sealedSecrets} WHERE kid = ${rotation.previous.kid}
          ORDER BY id LIMIT ${rowsInABatch}`,
      ),
    );
    const counts = yield* Effect.forEach(rows, (row) => resealedRow(execute, rotation, row));
    const resealed = counts.reduce((sum, count) => sum + count, before);
    return rows.length < rowsInABatch ? resealed : yield* resealedInBatches(execute, rotation, resealed);
  });
}

export function secretStoreOn(execute: StatementExecutor, keyring: Keyring, close: () => Promise<void>): SecretStore {
  const { current, previous } = keyring;
  return {
    kid: current.kid,
    keep: (value) =>
      Effect.suspend(() => {
        const refusal = refusalOf(Redacted.value(value));
        return refusal === undefined ? keptUnder(execute, current, Redacted.value(value)) : Effect.fail(refusal);
      }),
    read: (id) => readOn(execute, keyring, id),
    forget: (id) => commanded(execute, SQL`DELETE FROM ${sealedSecrets} WHERE id = ${id}`),
    rotated: () => (previous === undefined ? Effect.succeed(0) : resealedInBatches(execute, { current, previous }, 0)),
    close,
  };
}
