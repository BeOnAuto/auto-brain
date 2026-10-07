import type { ConflictKind, UnavailableBecause, UnavailableKind } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ExecutionOutcome, ExecutionResult, InterruptedAttempt } from '../execution/execution-commands.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
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

export const interruptedAttempt: InterruptedAttempt = { type: 'execution_interrupted' };

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

const decodeRecord = Schema.decodeUnknownEffect(Schema.JsonObject);

interface Recorded {
  readonly record?: Schema.JsonObject;
}

function rejectedWith(rejection: ExecutionRejection, { record }: Recorded): Effect.Effect<ExecutionResult> {
  if (record === undefined) {
    return Effect.succeed({ type: 'execution_rejected', rejection });
  }
  return decodeRecord(record).pipe(
    Effect.orDie,
    Effect.tap((checked) => withinResultLimit(checked)),
    Effect.map((checked): ExecutionResult => ({ type: 'execution_rejected', rejection, record: checked })),
  );
}

function rejectedForInput(rejection: Rejection & Recorded): Effect.Effect<ExecutionResult> {
  const { detail, issues } = rejection;
  return rejectedWith({ reason: 'invalid_input', detail, issues: issuesUnder('input', issues) }, rejection);
}

interface Unavailability extends Recorded {
  readonly detail: string;
  readonly kind?: UnavailableKind;
  readonly because?: UnavailableBecause;
}

function rejectedAsUnavailable(rejection: Unavailability): Effect.Effect<ExecutionResult> {
  const { detail, kind, because } = rejection;
  return rejectedWith(
    {
      reason: 'unavailable',
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    },
    rejection,
  );
}

interface Clash extends Recorded {
  readonly detail: string;
  readonly kind?: ConflictKind;
}

function rejectedAsConflict(rejection: Clash): Effect.Effect<ExecutionResult> {
  const { detail, kind } = rejection;
  return rejectedWith({ reason: 'conflict', detail, ...(kind === undefined ? {} : { kind }) }, rejection);
}

export function attempt(executing: Effect.Effect<Executed, PrimitiveRejection>): Effect.Effect<ExecutionOutcome> {
  return executing.pipe(
    Effect.flatMap(outcomeOf),
    Effect.catchTags({
      invalid_input: rejectedForInput,
      unavailable: rejectedAsUnavailable,
      conflict: rejectedAsConflict,
    }),
  );
}
