import { eventAppenderOf, eventCodecOf } from '@beonauto/ledger';
import { RunEventSchema, type PositionedEvent, type RunEvent, type RunStore } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { runForgotten } from '../listeners/listener-rows.ts';
import { streamOfRun } from './run-address.ts';
import { lineageOfRecord } from './run-lineage.ts';
import { latestSnapshotOf, savedSnapshot } from './snapshot-chunks.ts';

const codec = eventCodecOf(RunEventSchema);

function endsTheRun(event: RunEvent): boolean {
  return event.outputs.some(({ kind }) => kind === 'settle');
}

function positioned(after: number, events: readonly RunEvent[]): readonly PositionedEvent[] {
  return events.map((event, index) => ({ version: after + index + 1, event }));
}

function knownRun(database: HostDatabase, runId: string): Effect.Effect<void> {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_runs (run_id, stream_id) VALUES (${runId}, ${streamOfRun(runId)})
        ON CONFLICT (run_id) DO NOTHING`,
    ),
  );
}

function endedAt(database: HostDatabase, runId: string, version: number): Effect.Effect<void> {
  return Effect.orDie(
    database.write(statement`UPDATE workflow_runs SET ended_at = ${version} WHERE run_id = ${runId}`),
  ).pipe(Effect.andThen(runForgotten(database, runId)));
}

export function ledgerRunStore(database: HostDatabase): RunStore {
  const append = eventAppenderOf(database.store, RunEventSchema);
  const streamAfter = (runId: string, version: number) =>
    Effect.promise(() => database.store.read(streamOfRun(runId), version));
  const eventsAfter = (runId: string, version: number): Effect.Effect<readonly PositionedEvent[]> =>
    streamAfter(runId, version).pipe(
      Effect.flatMap(({ events }) => Effect.forEach(events, codec.decode)),
      Effect.map((events: readonly RunEvent[]) => positioned(version, events)),
    );
  return {
    load: (runId) =>
      Effect.gen(function* () {
        const snapshot = yield* latestSnapshotOf(database, runId);
        const tail = yield* eventsAfter(runId, snapshot?.snapshot.version ?? 0);
        return { snapshot, tail };
      }),
    append: (runId, event, expectedVersion, lineage) =>
      Effect.gen(function* () {
        if (expectedVersion === 0) {
          yield* knownRun(database, runId);
        }
        yield* append(streamOfRun(runId), [event], expectedVersion, yield* lineageOfRecord(database, runId, lineage));
        if (endsTheRun(event)) {
          yield* endedAt(database, runId, expectedVersion + 1);
        }
      }),
    eventsAfter,
    saveSnapshot: (snapshot) =>
      Effect.flatMap(streamAfter(snapshot.executionId, snapshot.version - 1), ({ events, version }) =>
        events.length > 0
          ? savedSnapshot(database, snapshot)
          : Effect.die(
              new RangeError(`A snapshot at version ${snapshot.version} of a run whose log holds ${version} events`),
            ),
      ),
  };
}
