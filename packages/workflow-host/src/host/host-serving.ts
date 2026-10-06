import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Consumer } from '../follower/consumers.ts';
import { startLoop } from '../loop/host-loop.ts';
import type { ProjectorSettings } from '../projector/projector-settings.ts';
import { startProjector } from '../projector/projector.ts';
import { startReacting } from '../reactions/host-reactions.ts';
import { hostEngineOn, type EngineOptions, type HostEngine } from './host-engine.ts';

export interface ServingOptions extends EngineOptions {
  readonly sweepEveryMs: number;
  readonly consumers?: readonly Consumer[];
  readonly views?: ProjectorSettings;
}

export interface Serving {
  readonly engine: HostEngine;
  readonly stopReacting: () => Promise<void>;
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
    options.consumers ?? [],
  );
  const { views } = options;
  const projector =
    views === undefined
      ? undefined
      : startProjector({
          database,
          settings: views,
          reports: options.reports,
          clock: options.clock,
          sweepEveryMs: options.sweepEveryMs,
        });
  return {
    engine,
    stopReacting: follower.stop,
    stop: async () => {
      await follower.stop();
      await loop.stop();
      await projector?.stop();
      await Effect.runPromise(engine.executor.stop());
    },
  };
}
