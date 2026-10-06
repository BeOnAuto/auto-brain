import { Effect } from 'effect';

import { runCacheOf, type RunCache } from '../cache/run-cache.ts';
import { workflowMachine } from '../decider/workflow-machine.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import type { EnginePorts } from './engine-ports.ts';
import { dispatchRun } from './output-dispatch.ts';
import { runLoopOf } from './run-loop.ts';
import { armedTimersOf, loadedFrom, snapshotIfDue } from './run-upkeep.ts';
import { submissionWithDeclined } from './submission.ts';
import type { Wake, WorkflowEngine } from './workflow-engine.ts';

const mostBehindRunsInOneSweep = 1024;

function dueRunsOf(ports: EnginePorts, before: number): Effect.Effect<readonly string[]> {
  return Effect.zipWith(
    ports.recordStore.dueRuns(before),
    ports.watermark.behindRuns(mostBehindRunsInOneSweep),
    (dueByTime, behind) => [...new Set([...dueByTime, ...behind])],
  );
}

export function workflowEngineOf(
  ports: EnginePorts,
  options: MachineOptions,
  cache: RunCache = runCacheOf(),
): WorkflowEngine {
  const loop = runLoopOf(ports.runStore, workflowMachine(options), cache);
  const loaded = (executionId: string) => loadedFrom(ports, executionId);
  const wake = (executionId: string): Effect.Effect<Wake> =>
    ports.serialiser.serialise(
      executionId,
      Effect.flatMap(loaded(executionId), ({ state, version }) => dispatchRun(ports, { executionId, state, version })),
    );
  const swept = (executionId: string): Effect.Effect<number> =>
    ports.serialiser.serialise(
      executionId,
      Effect.gen(function* () {
        const { state, version } = yield* loaded(executionId);
        yield* dispatchRun(ports, { executionId, state, version });
        const run = { executionId, attributes: state.attributes };
        return yield* Effect.orElseSucceed(ports.timers.sweep(run, armedTimersOf(executionId, state)), () => 0);
      }),
    );
  return {
    submit: (input) =>
      ports.serialiser.serialise(
        input.executionId,
        Effect.gen(function* () {
          const decision = yield* loop(input.executionId, input);
          if (decision.events.length > 0) {
            yield* snapshotIfDue(ports, cache, input.executionId, decision);
            yield* dispatchRun(ports, {
              executionId: input.executionId,
              state: decision.state,
              version: decision.version,
            });
          }
          return submissionWithDeclined(decision, input, options);
        }),
      ),
    wake,
    sweep: (before) =>
      Effect.gen(function* () {
        const due = yield* dueRunsOf(ports, before);
        const armedAgain = yield* Effect.forEach(due, (executionId) => swept(executionId));
        return { runs: due.length, timersArmedAgain: armedAgain.reduce((sum, count) => sum + count, 0) };
      }),
  };
}
