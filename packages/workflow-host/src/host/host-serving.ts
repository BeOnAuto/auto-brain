import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Consumer } from '../follower/consumers.ts';
import { startLoop } from '../loop/host-loop.ts';
import type { ProjectorSettings } from '../projector/projector-settings.ts';
import { startProjector } from '../projector/projector.ts';
import { startReacting } from '../reactions/host-reactions.ts';
import type { WaitingOptions } from '../waiting/waiting-options.ts';
import { executorWaitingOf, servedWaitingOf, type ServedWaiting } from '../waiting/waiting-parts.ts';
import { hostEngineOn, type EngineOptions, type HostEngine } from './host-engine.ts';

export interface ServingOptions extends EngineOptions {
  readonly sweepEveryMs: number;
  readonly consumers?: readonly Consumer[];
  readonly views?: ProjectorSettings;
  readonly waiting: WaitingOptions;
  readonly mostOpenCalls?: number;
}

export interface Serving {
  readonly engine: HostEngine;
  readonly stopReacting: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

function followerOf(database: HostDatabase, options: ServingOptions, engine: HostEngine, { calls }: ServedWaiting) {
  return startReacting(
    {
      database,
      submitted: engine.submitted,
      clock: options.clock,
      sweepEveryMs: options.sweepEveryMs,
      reports: options.reports,
    },
    options.reactions,
    engine.reacting.refusals,
    { consumers: options.consumers ?? [], calls },
  );
}

function servedOf(database: HostDatabase, options: ServingOptions, engine: HostEngine): ServedWaiting {
  return servedWaitingOf({
    database,
    submitted: engine.submitted,
    resultOf: options.waiting.resultOf,
    settle: options.settle,
    cancelDeferred: options.waiting.cancelDeferred,
    workflows: options.reactions.primitive,
    now: options.clock.now,
  });
}

export function startServing(database: HostDatabase, options: ServingOptions): Serving {
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const waiting = executorWaitingOf(database, options.machine, options.waiting, options.mostOpenCalls);
  const engine = hostEngineOn(database, options, waiting, (dueAt) => {
    alarm.armed(dueAt);
  });
  const served = servedOf(database, options, engine);
  const loop = startLoop({
    clock: options.clock,
    timers: engine.timers,
    engine: engine.engine,
    fire: ({ runId, timerId }, at) =>
      Effect.andThen(
        served.endedChildren(runId),
        engine.submitted({ kind: 'timer_fired', executionId: runId, at, timerId }),
      ),
    resume: engine.executor.resume,
    trouble: options.reports.trouble,
    sweepEveryMs: options.sweepEveryMs,
  });
  alarm.armed = loop.armed;
  const follower = followerOf(database, options, engine, served);
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
