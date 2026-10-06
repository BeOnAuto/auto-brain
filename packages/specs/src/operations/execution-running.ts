import { BrainContext, CallLineage, Caller } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionOutcome, ExecutionRequest } from '../execution/execution-commands.ts';
import { claimOf } from '../execution/execution-decisions.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { Primitive, PreparedDefinition, RunContext } from '../primitive/primitive.ts';
import { toolCallJournal, type RunJournal } from '../tool-calls/tool-call-journal.ts';
import { loadExecution, newExecutionId, recordExecution } from './execution-access.ts';
import { attempt, failedAttempt } from './execution-attempt.ts';
import { preparedSpec, preparedVersion, type VersionToRun } from './spec-preparation.ts';

function finishedBy(id: string, journal: RunJournal, execution: RunContext, outcome: ExecutionOutcome) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'execution_deferred' ? execution.lineage.startId : yield* journal.latest;
    const lineage = { causationId, correlationId: execution.lineage.correlationId };
    return yield* recordExecution(id, { type: 'finish', result: outcome }, lineage);
  });
}

interface Prepared {
  readonly spec: VersionToRun;
  readonly prepared: PreparedDefinition;
  readonly createOnly?: true;
}

const runExecution = Effect.fnUntraced(function* (id: string, request: ExecutionRequest, run: Prepared) {
  const { spec, prepared } = run;
  const { org, brain } = yield* BrainContext;
  const caller = yield* Caller;
  const { lineage: given, depth } = yield* CallLineage;
  const correlationId = given?.correlationId ?? id;
  const recorded = yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId } = yield* recordExecution(
        id,
        {
          type: 'start',
          ...request,
          spec_version: spec.version,
          calls_tools: prepared.callsTools,
          depth,
          ...(run.createOnly === true ? { createOnly: true } : {}),
        },
        { causationId: given?.causationId ?? null, correlationId },
      );
      const lineage = { startId: messageId, correlationId };
      const journal = yield* toolCallJournal(id, lineage);
      const execution = {
        id,
        org,
        brain,
        caller,
        spec: { name: spec.name, version: spec.version },
        journal,
        lineage,
        depth,
      };
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
  return claim === 'answer'
    ? yield* answerOf(id, recorded)
    : yield* runExecution(id, request, yield* preparedSpec(primitive, request.name));
});

export const startVersionOnce = Effect.fnUntraced(function* (
  primitive: Primitive,
  request: ExecutionRequest & { readonly version: number },
  id: string,
) {
  const recorded = yield* loadExecution(id);
  if (recorded !== undefined) {
    return yield* answerOf(id, recorded);
  }
  const { version, ...asked } = request;
  const run = yield* preparedVersion(primitive, asked.name, version);
  return yield* runExecution(id, asked, { ...run, createOnly: true });
});
