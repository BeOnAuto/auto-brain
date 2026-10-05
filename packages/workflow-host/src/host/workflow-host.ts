import type { Conflict } from '@beonauto/operations';
import { loadedRunOf, type ReceivedEvent, type RunState, type Started } from '@beonauto/workflow-engine';
import { Data, Effect, Function, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';
import { statement } from '../database/statement.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { startLoop } from '../loop/host-loop.ts';
import { runIdOf, type RunAddress } from '../runs/run-address.ts';
import { hostEngineOn, type EngineOptions, type HostEngine } from './host-engine.ts';

export interface HostOptions extends Omit<EngineOptions, 'clock'> {
  readonly database: DatabaseSettings;
  readonly sweepEveryMs: number;
  readonly clock?: HostClock;
}

export type RunStart = Omit<Started, 'kind' | 'executionId' | 'at'>;

export type StartAnswer = 'started' | 'going' | 'settled';

export type DeliveryAnswer = 'delivered' | 'not_started' | 'ended';

export class HostStopped extends Data.TaggedError('host_stopped')<{ readonly detail: string }> {}

export interface WorkflowHost {
  readonly start: (run: RunAddress, start: RunStart) => Effect.Effect<StartAnswer, Conflict | HostStopped>;
  readonly deliver: (run: RunAddress, event: ReceivedEvent) => Effect.Effect<DeliveryAnswer, Conflict | HostStopped>;
  readonly stateOf: (run: RunAddress) => Effect.Effect<RunState>;
  readonly stop: () => Promise<void>;
}

interface Gate {
  readonly guarded: <A, E>(work: Effect.Effect<A, E>) => Effect.Effect<A, E | HostStopped>;
  readonly closed: () => Promise<void>;
}

const SettlementRow = Schema.Struct({ settlement: Schema.NullOr(Schema.String) });

function settledOf(database: HostDatabase, runId: string): Effect.Effect<boolean> {
  return Effect.orDie(
    rowsOf(
      SettlementRow,
      database.read(statement`SELECT settlement FROM workflow_settlements WHERE run_id = ${runId}`),
    ),
  ).pipe(Effect.map((rows) => rows.some(({ settlement }) => settlement !== null)));
}

function gate(): Gate {
  const calls = { open: 0, stopping: false, drained: Promise.withResolvers<void>() };
  const left = (): void => {
    if (calls.stopping && calls.open === 0) {
      calls.drained.resolve();
    }
  };
  return {
    guarded: <A, E>(work: Effect.Effect<A, E>) =>
      Effect.suspend((): Effect.Effect<A, E | HostStopped> => {
        if (calls.stopping) {
          return Effect.fail(new HostStopped({ detail: 'The server is stopping' }));
        }
        calls.open += 1;
        return work.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              calls.open -= 1;
              left();
            }),
          ),
        );
      }),
    closed: () => {
      calls.stopping = true;
      left();
      return calls.drained.promise;
    },
  };
}

function runsOn(database: HostDatabase, { runStore, submitted }: HostEngine, clock: HostClock) {
  const stateOf = (runId: string): Effect.Effect<RunState> =>
    Effect.map(runStore.load(runId), (stored) => loadedRunOf(stored).state);
  return {
    stateOf,
    start: (run: RunAddress, start: RunStart): Effect.Effect<StartAnswer, Conflict> =>
      Effect.gen(function* () {
        const runId = runIdOf(run);
        if (yield* settledOf(database, runId)) {
          return 'settled';
        }
        if ((yield* stateOf(runId)).status !== 'new') {
          return 'going';
        }
        const { outcome } = yield* submitted({ ...start, kind: 'started', executionId: runId, at: clock.now() });
        return outcome === 'applied' ? 'started' : 'going';
      }),
    deliver: (run: RunAddress, event: ReceivedEvent): Effect.Effect<DeliveryAnswer, Conflict> =>
      Effect.gen(function* () {
        const runId = runIdOf(run);
        const { outcome } = yield* submitted({ kind: 'event_received', executionId: runId, at: clock.now(), event });
        if (outcome !== 'stale') {
          return outcome === 'applied' ? 'delivered' : 'not_started';
        }
        return (yield* stateOf(runId)).status === 'ended' ? 'ended' : 'delivered';
      }),
  };
}

export async function openWorkflowHost(options: HostOptions): Promise<WorkflowHost> {
  const clock = options.clock ?? systemClock;
  const database = await openHostDatabase(options.database, options.reports.lostConnection);
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const host = hostEngineOn(database, { ...options, clock }, (dueAt) => {
    alarm.armed(dueAt);
  });
  const loop = startLoop({
    clock,
    timers: host.timers,
    engine: host.engine,
    fire: ({ runId, timerId }, at) => host.submitted({ kind: 'timer_fired', executionId: runId, at, timerId }),
    resume: host.executor.resume,
    trouble: options.reports.trouble,
    sweepEveryMs: options.sweepEveryMs,
  });
  alarm.armed = loop.armed;
  const { guarded, closed } = gate();
  const runs = runsOn(database, host, clock);
  const stopped = async (): Promise<void> => {
    await closed();
    await loop.stop();
    await Effect.runPromise(host.executor.stop());
    await database.close();
  };
  const stopping: { done?: Promise<void> } = {};
  return {
    start: (run, start) => guarded(runs.start(run, start)),
    deliver: (run, event) => guarded(runs.deliver(run, event)),
    stateOf: (run) => runs.stateOf(runIdOf(run)),
    stop: () => {
      stopping.done ??= stopped();
      return stopping.done;
    },
  };
}
