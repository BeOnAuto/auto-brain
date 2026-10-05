import type { Conflict } from '@beonauto/operations';
import type { ReceivedEvent, RunState } from '@beonauto/workflow-engine';
import { Effect, Function } from 'effect';

import { openHostDatabase, type DatabaseSettings } from '../database/host-databases.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { startLoop } from '../loop/host-loop.ts';
import { runIdOf, type RunAddress } from '../runs/run-address.ts';
import { hostEngineOn, type EngineOptions } from './host-engine.ts';
import { gate, type HostStopped } from './host-gate.ts';
import { runRequests, type DeliveryAnswer, type RunStart, type StartAnswer } from './run-requests.ts';

export interface HostOptions extends Omit<EngineOptions, 'clock'> {
  readonly database: DatabaseSettings;
  readonly sweepEveryMs: number;
  readonly clock?: HostClock;
}

type Refusal = Conflict | HostStopped;

export interface WorkflowHost {
  readonly start: (run: RunAddress, start: RunStart) => Effect.Effect<StartAnswer, Refusal>;
  readonly deliver: (run: RunAddress, event: ReceivedEvent) => Effect.Effect<DeliveryAnswer, Refusal>;
  readonly stateOf: (run: RunAddress) => Effect.Effect<RunState>;
  readonly stop: () => Promise<void>;
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
  const runs = runRequests({ database, clock, engine: host });
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
