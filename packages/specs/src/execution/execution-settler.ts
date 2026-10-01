import {
  BrainIdSchema,
  NotFound,
  OrgIdSchema,
  streamPrefixOfBrain,
  type Conflict,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import { executionDecider, executionStreamOf } from './execution-decider.ts';
import { executionOf } from './execution-lookup.ts';
import type { Execution } from './execution.ts';
import { withinResultLimit } from './recorded-size.ts';

export interface ExecutionAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}

export type Settlement =
  | { readonly status: 'succeeded'; readonly output: Schema.Json; readonly record: Schema.JsonObject }
  | { readonly status: 'rejected'; readonly reason: 'invalid_input' | 'unavailable'; readonly detail: string }
  | { readonly status: 'failed' };

export type SettleExecution = (
  execution: ExecutionAddress,
  settlement: Settlement,
) => Effect.Effect<Execution, NotFound | Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeSuccess = Schema.decodeUnknownEffect(Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }));

const failure: ExecutionResult = { type: 'execution_failed' };

function streamOf(address: ExecutionAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address)
    ? Effect.succeed(`${streamPrefixOfBrain(address)}${executionStreamOf(address.id.toLowerCase())}`)
    : Effect.fail(new NotFound({ detail: 'There is no such execution in this brain' }));
}

function resultOf(settlement: Settlement): Effect.Effect<ExecutionResult> {
  if (settlement.status === 'succeeded') {
    return decodeSuccess(settlement).pipe(
      Effect.orDie,
      Effect.tap(({ output, record }) => withinResultLimit(output, record)),
      Effect.map(({ output, record }): ExecutionResult => ({ type: 'execution_succeeded', output, record })),
    );
  }
  if (settlement.status === 'rejected') {
    const { reason, detail } = settlement;
    return Effect.succeed({
      type: 'execution_rejected',
      rejection: reason === 'invalid_input' ? { reason, detail, issues: [] } : { reason, detail },
    });
  }
  return Effect.succeed(failure);
}

export function executionSettler(ledger: StreamWriter): SettleExecution {
  const settle = Effect.fnUntraced(function* (stream: string, result: ExecutionResult) {
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* ledger.execute(stream, executionDecider, { type: 'settle', result, at });
  });
  return (execution, settlement) =>
    Effect.gen(function* () {
      const stream = yield* streamOf(execution);
      const result = yield* resultOf(settlement).pipe(Effect.tapDefect(() => Effect.ignore(settle(stream, failure))));
      const { state } = yield* settle(stream, result);
      return yield* executionOf(execution.id.toLowerCase(), state);
    });
}
