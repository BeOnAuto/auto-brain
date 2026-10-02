import { BrainContext, Caller } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionRequest } from '../execution/execution-commands.ts';
import { claimOf } from '../execution/execution-decisions.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { loadExecution, newExecutionId, recordExecution } from './execution-access.ts';
import { attempt, failedAttempt } from './execution-attempt.ts';
import { preparedSpec } from './spec-preparation.ts';

const runExecution = Effect.fnUntraced(function* (primitive: Primitive, id: string, request: ExecutionRequest) {
  const { spec, prepared } = yield* preparedSpec(primitive, request.name);
  yield* recordExecution(id, { type: 'start', ...request, spec_version: spec.version });
  const { org, brain } = yield* BrainContext;
  const caller = yield* Caller;
  const execution = { id, org, brain, caller, spec: { name: spec.name, version: spec.version } };
  const result = yield* attempt(prepared, request.input, execution).pipe(
    Effect.tapDefect(() => Effect.ignore(recordExecution(id, { type: 'finish', result: failedAttempt }))),
  );
  return yield* answerOf(id, yield* recordExecution(id, { type: 'finish', result }));
});

export const executeRequest = Effect.fnUntraced(function* (
  primitive: Primitive,
  request: ExecutionRequest,
  suppliedId: string | undefined,
) {
  const id = suppliedId ?? (yield* newExecutionId);
  const recorded = yield* loadExecution(id);
  const claim = yield* Effect.fromResult(claimOf(recorded, request));
  return yield* claim === 'answer' ? answerOf(id, recorded) : runExecution(primitive, id, request);
});
