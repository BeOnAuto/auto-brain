import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import type { CallResult } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import { defaultLimits, defaultSeed, testMachine } from '@beonauto/workflow-engine/testing';
import { Effect, Function, Schema } from 'effect';

import type { DatabaseSettings } from './src/database/host-databases.ts';
import { openWorkflowHost, type WorkflowHost } from './src/host/workflow-host.ts';

const [settingsText = '', mode = '', settlementsFile = ''] = process.argv.slice(2);

const settings: DatabaseSettings = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
      Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
    ]),
  ),
)(settingsText);

const run = { org: 'acme', brain: 'alpha', executionId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const notifying = {
  document: { dsl: '1.0.3', namespace: 'acme', name: 'notifying', version: '1.0.0' },
  do: [{ notify: { call: 'notify', with: { to: 'ada' } } }],
};

function said(line: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stdout.write(`${line}\n`);
  });
}

const hangs = Effect.never;

const answered: Effect.Effect<CallResult> = Effect.succeed({ status: 'succeeded', output: 'sent' });

const settle: SettleExecution = ({ id }, settlement) =>
  mode === 'hang-on-settle'
    ? Effect.andThen(said('settling'), hangs)
    : Effect.sync(() => {
        appendFileSync(settlementsFile, `${JSON.stringify({ id, settlement })}\n`);
        return {
          execution_id: id,
          primitive: 'orchestration',
          name: 'notifying',
          spec_version: 1,
          status: 'succeeded',
          started_at: '2026-10-05T09:00:00.000Z',
          started_by: 'acme-admin',
        } as const;
      });

async function settledIn(host: WorkflowHost): Promise<void> {
  if (existsSync(settlementsFile) && readFileSync(settlementsFile, 'utf8') !== '') {
    await host.stop();
    return;
  }
  await setTimeout(20);
  await settledIn(host);
}

const host = await openWorkflowHost({
  database: settings,
  machine: testMachine,
  perform: () => (mode === 'hang-on-call' ? Effect.andThen(said('calling'), hangs) : answered),
  settle,
  reports: {
    unsettled: () => Effect.void,
    trouble: () => Effect.void,
    lostConnection: Function.constVoid,
    note: () => Effect.void,
  },
  sweepEveryMs: 20,
  mostCallsAtOnce: 1,
});

if (mode === 'finish') {
  await settledIn(host);
} else {
  await Effect.runPromise(
    host.start(run, { document: notifying, input: {}, limits: defaultLimits, attributes: {}, seed: defaultSeed }),
  );
}
