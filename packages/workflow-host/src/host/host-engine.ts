import type { Conflict } from '@beonauto/operations';
import {
  runCacheBounds,
  runCacheOf,
  workflowEngineOf,
  type MachineOptions,
  type RunCacheBounds,
  type RunInput,
  type RunStore,
  type Submission,
  type WorkflowEngine,
} from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import { hostExecutor, type HostExecutor, type Perform } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { ReactionOptions } from '../reactions/reaction-options.ts';
import { reactionPortsOn, type ReactionPorts } from '../reactions/reaction-ports.ts';
import { sqlTimers, type TimerTable } from '../timers/sql-timers.ts';
import { hostPortsOn, type PortParts } from './host-ports.ts';

export interface EngineOptions extends Pick<PortParts, 'settle' | 'reports'> {
  readonly machine: MachineOptions;
  readonly perform: Perform;
  readonly mostCallsAtOnce: number;
  readonly clock: HostClock;
  readonly cacheBounds?: RunCacheBounds;
  readonly reactions: ReactionOptions;
}

export interface HostEngine {
  readonly engine: WorkflowEngine;
  readonly runStore: RunStore;
  readonly timers: TimerTable;
  readonly executor: HostExecutor;
  readonly reacting: ReactionPorts;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
}

export function hostEngineOn(
  database: HostDatabase,
  options: EngineOptions,
  armed: (dueAt: number) => void,
): HostEngine {
  const { reports, clock } = options;
  const timers = sqlTimers(database, armed);
  const submitted = (input: RunInput): Effect.Effect<Submission, Conflict> =>
    Effect.uninterruptible(engine.submit(input));
  const executor = hostExecutor({
    database,
    perform: options.perform,
    deliver: (key, result) =>
      submitted({ kind: 'call_answered', executionId: key.executionId, at: clock.now(), key, result }),
    trouble: reports.trouble,
    mostAtOnce: options.mostCallsAtOnce,
  });
  const reacting = reactionPortsOn(database, options.reactions, clock.now);
  const ports = hostPortsOn(database, {
    settle: options.settle,
    reports,
    timers: timers.timers,
    executor: executor.executor,
    listeners: reacting.listeners,
    emitter: reacting.emitter,
    now: clock.now,
  });
  const engine = workflowEngineOf(ports, options.machine, runCacheOf(options.cacheBounds ?? runCacheBounds));
  return { engine, runStore: ports.runStore, timers, executor, reacting, submitted };
}
