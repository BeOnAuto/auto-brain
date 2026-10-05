import { Effect } from 'effect';

import { workflowMachine } from '../decider/workflow-machine.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { dispatchRun } from './output-dispatch.ts';
import { runLoopOf, submissionOf } from './run-loop.ts';
import { armedTimersOf, snapshotIfDue } from './run-upkeep.ts';
import type { EnginePorts, Wake, WorkflowEngine } from './workflow-engine.ts';

export function workflowEngineOf(ports: EnginePorts, options: MachineOptions): WorkflowEngine {
  const loop = runLoopOf(ports.runStore, workflowMachine(options));
  const loaded = (executionId: string): Effect.Effect<ReturnType<typeof loadedRunOf>> =>
    Effect.map(ports.runStore.load(executionId), (stored) => loadedRunOf(stored));
  const wake = (executionId: string): Effect.Effect<Wake> =>
    ports.serialiser.serialise(
      executionId,
      Effect.flatMap(loaded(executionId), ({ state, version }) => dispatchRun(ports, state, version)),
    );
  return {
    submit: (input) =>
      ports.serialiser.serialise(
        input.executionId,
        Effect.gen(function* () {
          const decision = yield* loop(input.executionId, input);
          if (decision.events.length > 0) {
            yield* snapshotIfDue(ports, decision);
            yield* dispatchRun(ports, decision.state, decision.version);
          }
          return submissionOf(decision, input);
        }),
      ),
    wake,
    sweep: (before) =>
      Effect.gen(function* () {
        const due = yield* ports.recordStore.dueRuns(before);
        const armedAgain = yield* Effect.forEach(due, (executionId) =>
          Effect.gen(function* () {
            yield* wake(executionId);
            const { state } = yield* loaded(executionId);
            const run = { executionId, attributes: state.attributes };
            return yield* Effect.orElseSucceed(ports.timers.sweep(run, armedTimersOf(state)), () => 0);
          }),
        );
        return { runs: due.length, timersArmedAgain: armedAgain.reduce((sum, count) => sum + count, 0) };
      }),
  };
}
