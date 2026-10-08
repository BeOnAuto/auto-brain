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

import { changedSinceRead, executionDeciderAsRead, executionStreamOf } from '../execution/execution-decider.ts';
import { endedWithAnotherResult } from '../execution/execution-decisions.ts';
import { executionSettlerAsRead, type ExecutionAddress } from '../execution/execution-settler.ts';
import { runOf, takesSettlement } from '../execution/execution-state.ts';
import { cancelledAsAsked, type CancelledRun, type Primitive } from '../primitive/primitive.ts';
import type { CancelRequest } from './run-cancels.ts';

export type SettleCancelled = (
  execution: ExecutionAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<void, NotFound | Conflict>;

const brokeDown: Settlement = { status: 'failed' };

const readsAgainAtMost = 3;

function endedOtherwise(error: unknown): boolean {
  return Equal.equals(error, endedWithAnotherResult);
}

function changedMeanwhile(error: unknown): boolean {
  return Equal.equals(error, changedSinceRead);
}

function decided(primitive: Primitive | undefined, run: CancelledRun): Effect.Effect<Settlement> {
  const cancel = primitive?.cancel ?? cancelledAsAsked;
  return Effect.try({ try: () => cancel(run), catch: () => brokeDown }).pipe(Effect.orElseSucceed(() => brokeDown));
}

export function deferredCanceller(
  primitives: readonly Primitive[],
  ledger: StreamReader & StreamWriter,
): SettleCancelled {
  const settle = executionSettlerAsRead(ledger);
  const settledAsRead: SettleCancelled = (execution, { kind, reason, by }, lineage) =>
    Effect.gen(function* () {
      const stream = `${streamPrefixOfBrain(execution)}${executionStreamOf(execution.id.toLowerCase())}`;
      const read = (yield* ledger.load(stream, executionDeciderAsRead)).state;
      const state = runOf(read.state);
      if (state === undefined || !takesSettlement(state)) {
        return;
      }
      const primitive = primitives.find(({ name }) => name === state.execution.primitive);
      const settlement = yield* decided(primitive, {
        record: state.record ?? {},
        kind,
        reason,
        channelAnswer: state.channelAnswer,
        deliveredAt: state.deliveredAt,
      });
      const actor = settlement.by ?? by ?? brainCallerOf(execution).id;
      yield* settle(execution, { ...settlement, by: actor }, read.version, lineage).pipe(
        Effect.asVoid,
        Effect.catchIf(endedOtherwise, () => Effect.void),
      );
    });
  return (execution, request, lineage) =>
    settledAsRead(execution, request, lineage).pipe(Effect.retry({ times: readsAgainAtMost, while: changedMeanwhile }));
}
