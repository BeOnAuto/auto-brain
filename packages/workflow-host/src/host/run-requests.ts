import type { Conflict } from '@beonauto/operations';
import { loadedRunOf, type ReceivedEvent, type RunState, type Started } from '@beonauto/workflow-engine';
import { Data, Effect, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { runIdOf, type RunAddress } from '../runs/run-address.ts';
import { backOffLifted } from '../settlement/settle-attempts.ts';
import type { HostEngine } from './host-engine.ts';

export type RunStart = Omit<Started, 'kind' | 'executionId' | 'at'>;

export type StartAnswer = 'started' | 'going' | 'settled';

export type DeliveryAnswer = 'delivered' | 'not_started' | 'ended';

export class HostElsewhere extends Data.TaggedError('host_elsewhere')<{ readonly detail: string }> {}

export interface RunRequests {
  readonly start: (run: RunAddress, start: RunStart) => Effect.Effect<StartAnswer, Conflict | HostElsewhere>;
  readonly deliver: (run: RunAddress, event: ReceivedEvent) => Effect.Effect<DeliveryAnswer, Conflict | HostElsewhere>;
  readonly stateOf: (runId: string) => Effect.Effect<RunState>;
}

export interface RequestParts {
  readonly database: HostDatabase;
  readonly clock: HostClock;
  readonly serving: () => HostEngine | undefined;
}

const elsewhere = new HostElsewhere({
  detail:
    'The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops',
});

const SettlementRow = Schema.Struct({ settlement: Schema.NullOr(Schema.String) });

function settledOf(database: HostDatabase, runId: string): Effect.Effect<boolean> {
  return Effect.orDie(
    rowsOf(
      SettlementRow,
      database.read(statement`SELECT settlement FROM workflow_settlements WHERE run_id = ${runId}`),
    ),
  ).pipe(Effect.map((rows) => rows.some(({ settlement }) => settlement !== null)));
}

function servingIn({ serving }: RequestParts): Effect.Effect<HostEngine, HostElsewhere> {
  return Effect.suspend(() => {
    const engine = serving();
    return engine === undefined ? Effect.fail(elsewhere) : Effect.succeed(engine);
  });
}

function settledAgain(parts: RequestParts, engine: HostEngine, runId: string): Effect.Effect<StartAnswer> {
  return Effect.gen(function* () {
    yield* Effect.orDie(backOffLifted(parts.database, runId));
    yield* engine.engine.wake(runId);
    if (yield* settledOf(parts.database, runId)) {
      return 'settled';
    }
    yield* Effect.orDie(backOffLifted(parts.database, runId));
    return 'going';
  });
}

export function runRequests(parts: RequestParts): RunRequests {
  const { database, clock } = parts;
  const runStore = ledgerRunStore(database);
  const stateOf = (runId: string): Effect.Effect<RunState> =>
    Effect.map(runStore.load(runId), (stored) => loadedRunOf(stored).state);
  return {
    stateOf,
    start: (run, start) =>
      Effect.gen(function* () {
        const engine = yield* servingIn(parts);
        const runId = runIdOf(run);
        if (yield* settledOf(database, runId)) {
          return 'settled';
        }
        const { status } = yield* stateOf(runId);
        if (status === 'ended') {
          return yield* settledAgain(parts, engine, runId);
        }
        if (status !== 'new') {
          return 'going';
        }
        const { outcome } = yield* engine.submitted({ ...start, kind: 'started', executionId: runId, at: clock.now() });
        return outcome === 'applied' ? 'started' : 'going';
      }),
    deliver: (run, event) =>
      Effect.gen(function* () {
        const engine = yield* servingIn(parts);
        const runId = runIdOf(run);
        const { outcome } = yield* engine.submitted({
          kind: 'event_received',
          executionId: runId,
          at: clock.now(),
          event,
        });
        if (outcome !== 'stale') {
          return outcome === 'applied' ? 'delivered' : 'not_started';
        }
        return (yield* stateOf(runId)).status === 'ended' ? 'ended' : 'delivered';
      }),
  };
}
