import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger } from '@beonauto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { statement } from '../database/statement.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { ledgerRunStore } from './ledger-run-store.ts';
import { runIdOf } from './run-address.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(executionId);

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

const largeInput = { text: 'é'.repeat(700_000) };

function ledgerOn(fileName: string): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

describe('the run store of the host, keeping a run', () => {
  it('keeps the log of a run on the ledger, under the brain, where the history of the run reads it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));
    const ledger = await ledgerOn(file);

    const history = await Effect.runPromise(
      ledger.readRecorded(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: executionId },
        { order: 'asc', limit: 10 },
      ),
    );

    expect(history.records.map(({ stream, type }) => [stream, type])).toEqual([
      [`brain/acme/alpha/runs/${executionId}`, 'input_applied'],
    ]);
  });

  it('keeps a snapshot larger than a chunk in chunks outside the ledger, and loads the run from it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting, largeInput)));
    const database = await openedOn({ store: 'sqlite', file });
    const chunks = await Effect.runPromise(
      database.read(statement`SELECT version, chunk, chunks FROM workflow_snapshot_chunks ORDER BY chunk`),
    );
    const messages = await Effect.runPromise(database.read(statement`SELECT COUNT(*) AS messages FROM emt_messages`));

    const stored = await Effect.runPromise(ledgerRunStore(database).load(runIdOf(run)));

    expect(chunks).toEqual([
      { version: 1, chunk: 0, chunks: 2 },
      { version: 1, chunk: 1, chunks: 2 },
    ]);
    expect(messages).toEqual([{ messages: 1 }]);
    expect(stored.tail).toEqual([]);
    expect(stored.snapshot?.bytes).toBeGreaterThan(1_400_000);
    expect(await Effect.runPromise(hosted.host.stateOf(run))).toEqual(
      expect.objectContaining({ status: 'running', inputs: 1 }),
    );
  });
});
