import { Effect, Schema } from 'effect';

import type { ExecutionOutcome, ExecutionResult } from '../execution/execution-commands.ts';
import { withinResultLimit } from '../execution/recorded-size.ts';
import type { Executed, PrimitiveRejection } from '../primitive/primitive.ts';
import { issuesUnder, type Rejection } from './issue-pointers.ts';

const decodeExecuted = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }),
    Schema.Struct({ finishesLater: Schema.Literal(true), record: Schema.JsonObject }),
  ]),
);

export const failedAttempt: ExecutionResult = { type: 'execution_failed' };

function recordedOutcome(executed: Executed): Effect.Effect<ExecutionOutcome> {
  return 'finishesLater' in executed
    ? withinResultLimit(executed.record).pipe(
        Effect.map((): ExecutionOutcome => ({ type: 'execution_deferred', record: executed.record })),
      )
    : withinResultLimit(executed.output, executed.record).pipe(
        Effect.map((): ExecutionOutcome => ({
          type: 'execution_succeeded',
          output: executed.output,
          record: executed.record,
        })),
      );
}

function outcomeOf(executed: Executed): Effect.Effect<ExecutionOutcome> {
  return decodeExecuted(executed).pipe(Effect.orDie, Effect.flatMap(recordedOutcome));
}

function rejectedForInput({ detail, issues }: Rejection): Effect.Effect<ExecutionResult> {
  return Effect.succeed({
    type: 'execution_rejected',
    rejection: { reason: 'invalid_input', detail, issues: issuesUnder('input', issues) },
  });
}

function rejectedFor(
  reason: 'unavailable' | 'conflict',
): (rejection: { readonly detail: string }) => Effect.Effect<ExecutionResult> {
  return ({ detail }) => Effect.succeed({ type: 'execution_rejected', rejection: { reason, detail } });
}

export function attempt(executing: Effect.Effect<Executed, PrimitiveRejection>): Effect.Effect<ExecutionOutcome> {
  return executing.pipe(
    Effect.flatMap(outcomeOf),
    Effect.catchTags({
      invalid_input: rejectedForInput,
      unavailable: rejectedFor('unavailable'),
      conflict: rejectedFor('conflict'),
    }),
  );
}
