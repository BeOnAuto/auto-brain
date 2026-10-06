import { streamPrefixOfBrain } from '@beonauto/operations';
import { listenFiltersOf, loadedRunOf, valueAtPointer, type CallKey } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { reactionOfRun } from '../reactions/run-attributes.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { addressOfRun, streamOfRun } from '../runs/run-address.ts';

const RunRow = Schema.Struct({ run_id: Schema.String });

const scanOfListeners = 'listeners';

function listenersOfRun(database: HostDatabase, runId: string) {
  return Effect.gen(function* () {
    const { state, version } = loadedRunOf(yield* ledgerRunStore(database).load(runId));
    const document = state.workflow?.document ?? {};
    const { workflow } = reactionOfRun(state.attributes);
    yield* Effect.forEach(
      Object.entries(state.listeners),
      ([listener, key]: readonly [string, CallKey]) =>
        insertedListener(database, {
          runId,
          listener,
          brainKey: streamPrefixOfBrain(addressOfRun(runId)),
          streamId: streamOfRun(runId),
          armedBy: version,
          filters: JSON.stringify(listenFiltersOf(valueAtPointer(document, key.reference))),
          workflow,
          passed: true,
        }),
      { discard: true },
    );
  });
}

export function scannedListeners(database: HostDatabase): Effect.Effect<number> {
  return Effect.orDie(
    Effect.gen(function* () {
      const done = yield* database.read(
        statement`SELECT name FROM workflow_followed_scans WHERE name = ${scanOfListeners}`,
      );
      if (done.length > 0) {
        return 0;
      }
      const live = yield* rowsOf(
        RunRow,
        database.read(statement`SELECT run_id FROM workflow_runs WHERE ended_at IS NULL`),
      );
      yield* Effect.forEach(live, ({ run_id: runId }) => listenersOfRun(database, runId), { discard: true });
      yield* database.write(statement`INSERT INTO workflow_followed_scans (name) VALUES (${scanOfListeners})`);
      return live.length;
    }),
  );
}
