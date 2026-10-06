import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { startLoop } from '../loop/host-loop.ts';
import { startReacting } from '../reactions/host-reactions.ts';
import { hostEngineOn, type EngineOptions, type HostEngine } from './host-engine.ts';

export interface ServingOptions extends EngineOptions {
  readonly sweepEveryMs: number;
}

export interface Serving {
  readonly engine: HostEngine;
  readonly stop: () => Promise<void>;
}

export function startServing(database: HostDatabase, options: ServingOptions): Serving {
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const engine = hostEngineOn(database, options, (dueAt) => {
    alarm.armed(dueAt);
  });
  const loop = startLoop({
    clock: options.clock,
    timers: engine.timers,
    engine: engine.engine,
    fire: ({ runId, timerId }, at) => engine.submitted({ kind: 'timer_fired', executionId: runId, at, timerId }),
    resume: engine.executor.resume,
    trouble: options.reports.trouble,
    sweepEveryMs: options.sweepEveryMs,
  });
  alarm.armed = loop.armed;
  const follower = startReacting(
    {
      database,
      submitted: engine.submitted,
      clock: options.clock,
      sweepEveryMs: options.sweepEveryMs,
      reports: options.reports,
    },
    options.reactions,
    engine.reacting.refusals,
  );
  return {
    engine,
    stop: async () => {
      await follower.stop();
      await loop.stop();
      await Effect.runPromise(engine.executor.stop());
    },
  };
}
