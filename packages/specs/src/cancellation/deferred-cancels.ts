import {
  brainCallerOf,
  streamPrefixOfBrain,
  type Conflict,
  type Lineage,
  type NotFound,
  type Settlement,
  type StreamReader,
  type StreamWriter,
} from '@beonauto/operations';
import { Effect, Equal } from 'effect';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { endedWithAnotherResult } from '../execution/execution-decisions.ts';
import { executionSettler, type ExecutionAddress } from '../execution/execution-settler.ts';
import { isRunning } from '../execution/execution-state.ts';
import { cancelledAsAsked, type CancelledRun, type Primitive } from '../primitive/primitive.ts';
import type { CancelRequest } from './run-cancels.ts';

export type SettleCancelled = (
  execution: ExecutionAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<void, NotFound | Conflict>;

const brokeDown: Settlement = { status: 'failed' };

function endedOtherwise(error: unknown): boolean {
  return Equal.equals(error, endedWithAnotherResult);
}

function decided(primitive: Primitive | undefined, run: CancelledRun): Effect.Effect<Settlement> {
  const cancel = primitive?.cancel ?? cancelledAsAsked;
  return Effect.try({ try: () => cancel(run), catch: () => brokeDown }).pipe(Effect.orElseSucceed(() => brokeDown));
}

export function deferredCanceller(
  primitives: readonly Primitive[],
  ledger: StreamReader & StreamWriter,
): SettleCancelled {
  const settle = executionSettler(ledger);
  return (execution, { kind, reason, by }, lineage) =>
    Effect.gen(function* () {
      const stream = `${streamPrefixOfBrain(execution)}${executionStreamOf(execution.id.toLowerCase())}`;
      const { state } = yield* ledger.load(stream, executionDecider);
      if (state === undefined || !isRunning(state)) {
        return;
      }
      const primitive = primitives.find(({ name }) => name === state.execution.primitive);
      const settlement = yield* decided(primitive, { record: state.record ?? {}, kind, reason });
      yield* settle(execution, { ...settlement, by: by ?? brainCallerOf(execution).id }, lineage).pipe(
        Effect.asVoid,
        Effect.catchIf(endedOtherwise, () => Effect.void),
      );
    });
}
