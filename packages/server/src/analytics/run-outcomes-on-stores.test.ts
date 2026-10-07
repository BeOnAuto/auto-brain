import { randomUUID } from 'node:crypto';

import { postgresqlLedgerLayer } from '@beonauto/ledger/postgresql';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger, type Decider, type RunOutcomeGroup } from '@beonauto/operations';
import { Effect, ManagedRuntime, Redacted, Result, Schema, type Layer } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayerOf } from '../composition/ledger-store.ts';
import type { LedgerSettings } from '../settings/ledger-settings.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const FactSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

type Fact = typeof FactSchema.Type;

const facts: Decider<null, readonly Fact[], Fact> = {
  initialState: null,
  evolve: () => null,
  decide: (given) => Result.succeed(given),
  eventSchema: FactSchema,
};

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aPostgreSQLLedger(): Promise<LedgerSettings> {
  const name = `outcomes_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return { store: 'postgresql', url: Redacted.make(url.href), host: url.host, database: name };
}

function anSQLiteLedger(): Promise<LedgerSettings> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({ store: 'sqlite', file: ledger.fileName });
}

function opened(layer: Layer.Layer<Ledger>): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

const fact = { by: 'acme-admin' };

const usage = { input: { total: 1200, cache_read: 1000 }, output: { total: 300 } };

function started(name: string, at: string, primitive = 'inference'): Fact {
  return { type: 'execution_started', primitive, name, spec_version: 1, input: {}, ...fact, at };
}

function finished(type: string, at: string, more: Readonly<Record<string, Schema.Json>> = {}): Fact {
  return { type, ...fact, at, ...more };
}

const runs: readonly (readonly [string, readonly Fact[]])[] = [
  [
    'started-twice',
    [
      started('triage', '2026-10-01T09:00:00.000Z'),
      finished('execution_failed', '2026-10-01T09:00:01.000Z'),
      started('triage', '2026-10-01T10:00:00.000Z'),
      finished('tool_call_started', '2026-10-01T10:00:00.100Z', { number: 1 }),
      finished('execution_succeeded', '2026-10-01T10:00:00.250Z', { output: 'ok', record: { usage } }),
    ],
  ],
  [
    'without-usage',
    [
      started('triage', '2026-10-01T11:00:00.000Z'),
      finished('execution_succeeded', '2026-10-01T11:00:00.500Z', { output: 'ok', record: {} }),
    ],
  ],
  [
    'not-an-object',
    [
      started('triage', '2026-10-01T12:00:00.000Z'),
      finished('execution_succeeded', '2026-10-01T12:00:00.100Z', { output: 'ok', record: 'text' }),
    ],
  ],
  [
    'rejected-with-usage',
    [
      started('triage', '2026-10-01T13:00:00.000Z'),
      finished('execution_rejected', '2026-10-01T13:00:01.000Z', { rejection: {}, record: { usage } }),
    ],
  ],
  [
    'rejected',
    [
      started('triage', '2026-10-01T14:00:00.000Z'),
      finished('execution_rejected', '2026-10-01T14:00:01.000Z', { rejection: {} }),
    ],
  ],
  [
    'workflow',
    [
      started('approval', '2026-10-01T15:00:00.000Z', 'orchestration'),
      finished('execution_deferred', '2026-10-01T15:00:00.010Z', { record: {} }),
      finished('execution_succeeded', '2026-10-02T15:00:00.000Z', { output: {}, record: {} }),
    ],
  ],
  ['finish-alone', [finished('execution_failed', '2026-10-02T09:00:00.000Z')]],
  ['still-going', [started('draft', '2026-10-02T10:00:00.000Z')]],
];

function written(ledger: Ledger['Service']): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      runs,
      ([run, given]) =>
        Effect.forEach(given, (each) => ledger.execute(`brain/acme/alpha/executions/${run}`, facts, [each]), {
          discard: true,
        }),
      { discard: true },
    ),
  );
}

function withoutTheProjection(settings: LedgerSettings): Layer.Layer<Ledger> {
  return settings.store === 'sqlite'
    ? ledgerLayer({ fileName: settings.file })
    : postgresqlLedgerLayer({ connectionString: Redacted.value(settings.url) });
}

function lineOf(group: RunOutcomeGroup): string {
  const { day, primitive, name, status, inputTokens, outputTokens, cachedTokens } = group;
  const durations = group.durations.toSorted((left, right) => left - right).join(' ');
  const tokens = `${inputTokens} ${outputTokens} ${cachedTokens}`;
  return `${day} ${primitive}/${name} ${status} ${group.runs} [${durations}] ${tokens}`;
}

async function outcomesIn(ledger: Ledger['Service']): Promise<readonly string[]> {
  const groups = await Effect.runPromise(
    ledger.readRunOutcomes({ org: 'acme', brain: 'alpha' }, { from: '2026-10-01', to: '2026-10-02' }, {}),
  );
  return groups.map((group) => lineOf(group)).toSorted();
}

const kept = [
  '2026-10-01 inference/triage rejected 2 [] 1200 300 1000',
  '2026-10-01 inference/triage succeeded 3 [100 250 500] 1200 300 1000',
  '2026-10-01 orchestration/approval succeeded 1 [86400000] 0 0 0',
  '2026-10-02 / failed 1 [] 0 0 0',
  '2026-10-02 inference/draft started 1 [] 0 0 0',
];

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aLedger: () => Promise<LedgerSettings>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aLedger: anSQLiteLedger },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aLedger: aPostgreSQLLedger },
];

describe.each(stores)('the outcomes of runs the composed ledger keeps, on $store', ({ skipped, aLedger }) => {
  it.skipIf(skipped)(
    'are one row per run for every shape of run, as each append keeps it and as a fill replays it',
    async () => {
      const appended = await aLedger();
      const replayed = await aLedger();
      await written(await opened(ledgerLayerOf(appended)));
      await written(await opened(withoutTheProjection(replayed)));

      const inline = await outcomesIn(await opened(ledgerLayerOf(appended)));
      const filled = await outcomesIn(await opened(ledgerLayerOf(replayed)));

      expect([inline, filled]).toEqual([kept, kept]);
    },
  );
});
