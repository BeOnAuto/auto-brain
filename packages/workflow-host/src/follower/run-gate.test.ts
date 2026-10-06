import type { RecordedEvent } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { runGateOf } from './run-gate.ts';

const brainKey = 'brain/acme/alpha/';

const stream = `${brainKey}runs/r-1`;

const PassedRow = Schema.Struct({ listener: Schema.String, passed: WholeNumber });

function runRecord(version: number): RecordedEvent {
  return {
    id: `record-${version}`,
    cursor: `cursor-${version}`,
    causationId: null,
    correlationId: null,
    stream,
    version,
    type: 'input_applied',
    data: null,
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

function dispatchedThrough(database: HostDatabase, through: number) {
  return Effect.runPromise(
    database.write(
      statement`INSERT INTO workflow_runs (run_id, stream_id, dispatched_through) VALUES (${'acme/alpha/r-1'}, ${stream}, ${through})
        ON CONFLICT (run_id) DO UPDATE SET dispatched_through = excluded.dispatched_through`,
    ),
  );
}

function armedAt(database: HostDatabase, listener: string, armedBy: number) {
  return Effect.runPromise(
    insertedListener(database, {
      runId: 'acme/alpha/r-1',
      listener,
      brainKey,
      streamId: stream,
      armedBy,
      filters: '[]',
      workflow: 'wait',
      passed: false,
    }),
  );
}

describe('the gate the records of a run pass through to the follower', () => {
  it('holds a record until its outputs are dispatched, and passes the listeners it armed when it passes it', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(database, brainKey);
    await dispatchedThrough(database, 0);
    const held = await Effect.runPromise(gate.verdictOn(runRecord(1), false));
    await dispatchedThrough(database, 2);
    await armedAt(database, 'first', 1);
    await armedAt(database, 'second', 3);

    const verdicts = await Effect.runPromise(
      Effect.forEach([1, 2, 3], (version) => gate.verdictOn(runRecord(version), false)),
    );
    const listeners = await Effect.runPromise(
      rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners ORDER BY listener`)),
    );

    expect([held, verdicts]).toEqual(['held', ['listened', 'passed', 'held']]);
    expect(listeners).toEqual([
      { listener: 'first', passed: 1 },
      { listener: 'second', passed: 0 },
    ]);
  });

  it('passes a record held too long, and the listeners it armed, even those kept after it passed', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(database, brainKey);
    await dispatchedThrough(database, 0);
    await armedAt(database, 'before', 2);

    const verdict = await Effect.runPromise(gate.verdictOn(runRecord(2), true));
    await armedAt(database, 'after', 2);
    await armedAt(database, 'later', 3);
    const listeners = await Effect.runPromise(
      rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners ORDER BY listener`)),
    );

    expect(verdict).toBe('overdue');
    expect(listeners).toEqual([
      { listener: 'after', passed: 1 },
      { listener: 'before', passed: 1 },
      { listener: 'later', passed: 0 },
    ]);
  });
});
