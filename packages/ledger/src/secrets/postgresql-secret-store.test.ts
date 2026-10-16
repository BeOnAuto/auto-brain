import { Effect, Logger, Redacted } from 'effect';
import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { until } from '../testing/until.ts';
import { postgresqlSecretStore, type SecretConnections } from './postgresql-secret-store.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface FakeConnections {
  readonly pools: (bounds: { readonly max: number }) => SecretConnections;
  readonly asked: readonly Asked[];
  readonly bounds: readonly number[];
  readonly lose: (error: Readonly<Error>) => void;
  readonly ended: () => number;
}

function connectionsKeepingWhatTheyAreGiven(): FakeConnections {
  const asked: Asked[] = [];
  const bounds: number[] = [];
  const listeners: ((error: Readonly<Error>) => void)[] = [];
  const kept: unknown[] = [];
  let ended = 0;
  const connections: SecretConnections = {
    query: (text, values) => {
      asked.push({ text, values });
      kept.push(...(text.startsWith('INSERT') ? [values[2]] : []));
      return Promise.resolve({ rows: text.startsWith('SELECT sealed') ? kept.map((sealed) => ({ sealed })) : [] });
    },
    on: (_event, listener) => {
      listeners.push(listener);
    },
    end: () => {
      ended += 1;
      return Promise.resolve();
    },
  };
  return {
    pools: ({ max }) => {
      bounds.push(max);
      return connections;
    },
    asked,
    bounds,
    lose: (error) => {
      listeners.forEach((listener) => {
        listener(error);
      });
    },
    ended: () => ended,
  };
}

const keys = { current: Redacted.make(new Uint8Array(32).fill(5)) };

function revealed(read: Redacted.Redacted | undefined): string | undefined {
  return read === undefined ? read : Redacted.value(read);
}

function wordsOf(asked: readonly Asked[]): readonly string[] {
  return asked.map(({ text }) => text.replaceAll(/\s+/gu, ' ').split(' (')[0] ?? '');
}

describe('the secret store on PostgreSQL, without a database', () => {
  it('keeps, reads and forgets a secret on a pool of two connections of its own, binding every value', async () => {
    const fake = connectionsKeepingWhatTheyAreGiven();

    const store = await Effect.runPromise(postgresqlSecretStore({ pools: fake.pools, keys }));
    const id = await Effect.runPromise(store.keep(Redacted.make('pasted-key')));
    const read = await Effect.runPromise(store.read(id));
    await Effect.runPromise(store.forget(id));
    await store.close();

    expect(fake.bounds).toEqual([2]);
    expect(revealed(read)).toBe('pasted-key');
    expect(wordsOf(fake.asked)).toEqual([
      'INSERT INTO sealed_secrets',
      'SELECT sealed FROM sealed_secrets WHERE id = $1',
      'DELETE FROM sealed_secrets WHERE id = $1',
    ]);
    expect(fake.asked[0]?.values).toEqual([id, store.kid, expect.any(String), expect.any(String), null]);
    expect(decodeProtectedHeader(String(fake.asked[0]?.values[2]))).toMatchObject({ kid: store.kid });
    expect(JSON.stringify(fake.asked)).not.toContain('pasted-key');
    expect(fake.ended()).toBe(1);
  });

  it('logs a connection its pool loses as a lost connection of the ledger, through the loggers it was opened with', async () => {
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const fake = connectionsKeepingWhatTheyAreGiven();
    await Effect.runPromise(
      postgresqlSecretStore({ pools: fake.pools, keys }).pipe(Effect.provide(Logger.layer([capture]))),
    );

    fake.lose(new Error('terminating connection due to administrator command'));

    await until(() => {
      expect(logged).toEqual([
        expect.stringContaining(
          '{"message":"A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one","level":"WARN"',
        ),
      ]);
    });
    expect(logged[0]).toContain('"annotations":{"error":"terminating connection due to administrator command"}');
  });
});
