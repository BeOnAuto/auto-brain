import type { AppRuntime } from '@beonauto/api';
import { Ledger, type Dispatcher, type DispatcherServices } from '@beonauto/operations';
import { specExecutionResultOf, type ExecuteSpec } from '@beonauto/orchestration';
import { executionSettler, type BrainOperation, type SettleExecution } from '@beonauto/specs';
import { Effect, Exit } from 'effect';

export function inRuntime<A, E>(
  runtime: AppRuntime<DispatcherServices>,
  work: Effect.Effect<A, E, DispatcherServices>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const ran = yield* Effect.promise(() => runtime.run(Effect.exit(work)));
    if (!Exit.isExit(ran)) {
      return yield* Effect.die(new Error('The server stopped before the work could be done'));
    }
    return yield* ran;
  });
}

export function nestedExecutions(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  executeSpec: BrainOperation,
): ExecuteSpec {
  return ({ org, brain, caller, primitive, name, input, executionId }) =>
    inRuntime(
      runtime,
      dispatcher.dispatchToBrain(executeSpec.registration, {
        caller,
        org,
        brain,
        input: { primitive, name, input, execution_id: executionId },
        encoding: 'json',
      }),
    ).pipe(Effect.map(specExecutionResultOf));
}

export function settlements(runtime: AppRuntime<DispatcherServices>): SettleExecution {
  return (execution, settlement) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) => executionSettler(ledger)(execution, settlement)),
    );
}
