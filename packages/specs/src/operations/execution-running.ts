import { BrainContext, Caller } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionRequest } from '../execution/execution-commands.ts';
import { claimOf } from '../execution/execution-decisions.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { toolCallJournal } from '../tool-calls/tool-call-journal.ts';
import { loadExecution, newExecutionId, recordExecution } from './execution-access.ts';
import { attempt, failedAttempt } from './execution-attempt.ts';
import { preparedSpec } from './spec-preparation.ts';

const runExecution = Effect.fnUntraced(function* (primitive: Primitive, id: string, request: ExecutionRequest) {
  const { spec, prepared } = yield* preparedSpec(primitive, request.name);
  const { org, brain } = yield* BrainContext;
  const caller = yield* Caller;
  const journal = yield* toolCallJournal(id);
  const execution = { id, org, brain, caller, spec: { name: spec.name, version: spec.version }, journal };
  const recorded = yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* recordExecution(id, {
        type: 'start',
        ...request,
        spec_version: spec.version,
        calls_tools: prepared.callsTools,
      });
      const executing = prepared.execute(request.input, execution);
      const result = yield* attempt(prepared.whenCancelled === 'finish' ? executing : restore(executing)).pipe(
        Effect.onError(() => Effect.ignore(recordExecution(id, { type: 'finish', result: failedAttempt }))),
      );
      return yield* recordExecution(id, { type: 'finish', result });
    }),
  );
  return yield* answerOf(id, recorded);
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
