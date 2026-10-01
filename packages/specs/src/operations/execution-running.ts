import { BrainContext, Conflict } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ExecutionRequest, ExecutionResult } from '../execution/execution-commands.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { ExecutionContext, Executed, PreparedSpec, Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import type { StoredSpec } from '../registry/spec.ts';
import { recordExecution } from './execution-access.ts';
import { issuesUnder, type Refusal } from './issue-pointers.ts';
import { loadRegistry } from './registry-access.ts';

const decodeExecuted = Schema.decodeUnknownEffect(Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }));

const failedAttempt: ExecutionResult = { type: 'execution_failed' };

const activeSpec = Effect.fnUntraced(function* (primitive: string, name: string) {
  const spec = yield* findSpec(yield* loadRegistry(primitive), primitive, name);
  if (spec.status === 'retired') {
    return yield* new Conflict({ detail: `The ${primitive} spec ${name} is retired and can no longer be executed` });
  }
  return spec;
});

function unparseable(primitive: string, { name, version }: StoredSpec): (refusal: Refusal) => Conflict {
  return ({ detail }) =>
    new Conflict({
      detail: `The ${primitive} spec ${name} at version ${version} no longer parses (${detail}); update it`,
    });
}

function succeededWith(executed: Executed): Effect.Effect<ExecutionResult> {
  return decodeExecuted(executed).pipe(
    Effect.orDie,
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

function attempt(
  prepared: PreparedSpec,
  input: ExecutionRequest['input'],
  execution: ExecutionContext,
): Effect.Effect<ExecutionResult> {
  return prepared
    .execute(input, execution)
    .pipe(
      Effect.flatMap(succeededWith),
      Effect.catchTags({ invalid_input: rejectedForInput, unavailable: rejectedAsUnavailable }),
    );
}

export const runExecution = Effect.fnUntraced(function* (primitive: Primitive, id: string, request: ExecutionRequest) {
  const spec = yield* activeSpec(primitive.name, request.name);
  const prepared = yield* primitive.prepare(spec.source).pipe(Effect.mapError(unparseable(primitive.name, spec)));
  yield* recordExecution(id, { type: 'start', ...request, spec_version: spec.version });
  const { org, brain } = yield* BrainContext;
  const execution = { id, org, brain, spec: { name: spec.name, version: spec.version } };
  const result = yield* attempt(prepared, request.input, execution).pipe(
    Effect.tapDefect(() => Effect.ignore(recordExecution(id, { type: 'finish', result: failedAttempt }))),
  );
  return yield* answerOf(id, yield* recordExecution(id, { type: 'finish', result }));
});
