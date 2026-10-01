import { Effect, Schema } from 'effect';

import type { ExecutionResult } from '../execution/execution-commands.ts';
import { withinResultLimit } from '../execution/recorded-size.ts';
import type { ExecutionContext, Executed, PreparedSpec } from '../primitive/primitive.ts';
import { issuesUnder, type Refusal } from './issue-pointers.ts';

const decodeExecuted = Schema.decodeUnknownEffect(Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }));

export const failedAttempt: ExecutionResult = { type: 'execution_failed' };

function succeededWith(executed: Executed): Effect.Effect<ExecutionResult> {
  return decodeExecuted(executed).pipe(
    Effect.orDie,
    Effect.tap(({ output, record }) => withinResultLimit(output, record)),
    Effect.map(({ output, record }) => ({ type: 'execution_succeeded', output, record })),
  );
}

function rejectedForInput({ detail, issues }: Refusal): Effect.Effect<ExecutionResult> {
  return Effect.succeed({
    type: 'execution_rejected',
    rejection: { reason: 'invalid_input', detail, issues: issuesUnder('input', issues) },
  });
}

function rejectedAsUnavailable({ detail }: { readonly detail: string }): Effect.Effect<ExecutionResult> {
  return Effect.succeed({ type: 'execution_rejected', rejection: { reason: 'unavailable', detail } });
}

export function attempt(
  prepared: PreparedSpec,
  input: Schema.Json,
  execution: ExecutionContext,
): Effect.Effect<ExecutionResult> {
  return prepared
    .execute(input, execution)
    .pipe(
      Effect.flatMap(succeededWith),
      Effect.catchTags({ invalid_input: rejectedForInput, unavailable: rejectedAsUnavailable }),
    );
}
