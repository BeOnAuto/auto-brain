import { BrainContext, CallLineage, Caller } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionOutcome, ExecutionRequest } from '../execution/execution-commands.ts';
import { claimOf } from '../execution/execution-decisions.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { Primitive, RunContext } from '../primitive/primitive.ts';
import { toolCallJournal, type RunJournal } from '../tool-calls/tool-call-journal.ts';
import { loadExecution, newExecutionId, recordExecution } from './execution-access.ts';
import { attempt, failedAttempt } from './execution-attempt.ts';
import { preparedSpec } from './spec-preparation.ts';

function finishedBy(id: string, journal: RunJournal, execution: RunContext, outcome: ExecutionOutcome) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'execution_deferred' ? execution.lineage.startId : yield* journal.latest;
    const lineage = { causationId, correlationId: execution.lineage.correlationId };
    return yield* recordExecution(id, { type: 'finish', result: outcome }, lineage);
  });
}

const runExecution = Effect.fnUntraced(function* (primitive: Primitive, id: string, request: ExecutionRequest) {
  const { spec, prepared } = yield* preparedSpec(primitive, request.name);
  const { org, brain } = yield* BrainContext;
  const caller = yield* Caller;
  const { lineage: given } = yield* CallLineage;
  const correlationId = given?.correlationId ?? id;
  const recorded = yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId } = yield* recordExecution(
        id,
        { type: 'start', ...request, spec_version: spec.version, calls_tools: prepared.callsTools },
        { causationId: given?.causationId ?? null, correlationId },
      );
      const lineage = { startId: messageId, correlationId };
      const journal = yield* toolCallJournal(id, lineage);
      const execution = { id, org, brain, caller, spec: { name: spec.name, version: spec.version }, journal, lineage };
      const executing = prepared.execute(request.input, execution);
      const result = yield* attempt(prepared.whenCancelled === 'finish' ? executing : restore(executing)).pipe(
        Effect.onError(() => Effect.ignore(finishedBy(id, journal, execution, failedAttempt))),
      );
      return yield* finishedBy(id, journal, execution, result);
    }),
  );
  return yield* answerOf(id, recorded.state);
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
