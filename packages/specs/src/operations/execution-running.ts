import { BrainContext, BrainReader, CallLineage, Caller, Conflict, type GivenLineage } from '@beonauto/operations';
import { Cause, Effect, Option } from 'effect';

import type { ExecutionOutcome, ExecutionRequest, InterruptedAttempt } from '../execution/execution-commands.ts';
import { claimOf, runTaken } from '../execution/execution-decisions.ts';
import { answerOf } from '../execution/execution-lookup.ts';
import type { Primitive, PreparedDefinition, RunContext, RunLineage } from '../primitive/primitive.ts';
import { toolCallJournal, type RunJournal } from '../tool-calls/tool-call-journal.ts';
import { loadExecution, loadExecutionStream, newExecutionId, recordExecution } from './execution-access.ts';
import { attempt, failedAttempt, interruptedAttempt } from './execution-attempt.ts';
import { preparedSpec, preparedVersion, type VersionToRun } from './spec-preparation.ts';

export const mostCallDepth = 8;

interface JournalledRun extends RunContext {
  readonly journal: RunJournal;
}

interface Called extends GivenLineage {
  readonly primitives: readonly Primitive[];
}

function finishedBy(id: string, execution: JournalledRun, outcome: ExecutionOutcome | InterruptedAttempt) {
  return Effect.gen(function* () {
    const causationId =
      outcome.type === 'execution_deferred' ? execution.lineage.startId : yield* execution.journal.latest;
    const lineage = { causationId, correlationId: execution.lineage.correlationId };
    return yield* recordExecution(id, { type: 'finish', result: outcome }, lineage);
  });
}

interface Prepared {
  readonly spec: VersionToRun;
  readonly prepared: PreparedDefinition;
  readonly createOnly?: true;
}

function tooDeep(callDepth: number): Conflict {
  return new Conflict({
    detail: `This run would sit ${callDepth} calls below the run at the top of its tree, more than the ${mostCallDepth} a run may: workflows that call workflows reach at most ${mostCallDepth} calls deep`,
  });
}

const longestRunIn = Effect.fnUntraced(function* (primitive: Primitive, name: string) {
  const { prepared } = yield* preparedSpec(primitive, name);
  return prepared.longestRunMs;
});

const longestRunsIn = Effect.fnUntraced(function* (primitives: readonly Primitive[]) {
  const reader = yield* BrainReader;
  return (primitiveName: string, name: string): Effect.Effect<number | undefined> => {
    const primitive = primitives.find((candidate) => candidate.name === primitiveName);
    return primitive === undefined
      ? Effect.undefined
      : longestRunIn(primitive, name).pipe(
          Effect.option,
          Effect.map(Option.getOrUndefined),
          Effect.provideService(BrainReader, reader),
        );
  };
});

function startOf(request: ExecutionRequest, { spec, prepared, createOnly }: Prepared, given: GivenLineage) {
  const { depth, callDepth, calledBy, trigger } = given;
  return {
    type: 'start' as const,
    ...request,
    spec_version: spec.version,
    calls_tools: prepared.callsTools,
    finishes_later: prepared.finishesLater,
    depth,
    call_depth: callDepth,
    ...(calledBy === null ? {} : { called_by: calledBy }),
    ...(trigger === null ? {} : { trigger }),
    ...(createOnly === true ? { createOnly } : {}),
  };
}

const contextOf = Effect.fnUntraced(function* (id: string, { spec }: Prepared, lineage: RunLineage, given: Called) {
  const { org, brain } = yield* BrainContext;
  const execution: JournalledRun = {
    id,
    org,
    brain,
    caller: yield* Caller,
    spec: { name: spec.name, version: spec.version },
    journal: yield* toolCallJournal(id, lineage),
    lineage,
    depth: given.depth,
    callDepth: given.callDepth,
    longestRunOf: yield* longestRunsIn(given.primitives),
  };
  return execution;
});

const runExecution = Effect.fnUntraced(function* (
  primitives: readonly Primitive[],
  id: string,
  request: ExecutionRequest,
  run: Prepared,
) {
  const given: Called = { ...(yield* CallLineage), primitives };
  if (given.callDepth > mostCallDepth) {
    return yield* tooDeep(given.callDepth);
  }
  const correlationId = given.lineage?.correlationId ?? id;
  const recorded = yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId } = yield* recordExecution(id, startOf(request, run, given), {
        causationId: given.lineage?.causationId ?? null,
        correlationId,
      });
      const execution = yield* contextOf(id, run, { startId: messageId, correlationId }, given);
      const executing = run.prepared.execute(request.input, execution);
      const result = yield* attempt(run.prepared.whenCancelled === 'finish' ? executing : restore(executing)).pipe(
        Effect.onError((cause) =>
          Effect.ignore(finishedBy(id, execution, Cause.hasInterruptsOnly(cause) ? interruptedAttempt : failedAttempt)),
        ),
      );
      return yield* finishedBy(id, execution, result);
    }),
  );
  return yield* answerOf(id, recorded.state);
});

export const executeRequest = Effect.fnUntraced(function* (
  primitives: readonly Primitive[],
  primitive: Primitive,
  request: ExecutionRequest,
  suppliedId: string | undefined,
) {
  const id = suppliedId ?? (yield* newExecutionId);
  const recorded = yield* loadExecutionStream(id);
  const claim = yield* Effect.fromResult(claimOf(recorded, request));
  return claim === 'answer'
    ? yield* answerOf(id, recorded)
    : yield* runExecution(primitives, id, request, yield* preparedSpec(primitive, request.name));
});

function isTaken(error: unknown): error is Conflict {
  return error instanceof Conflict && error.kind === runTaken.kind;
}

export const startVersionOnce = Effect.fnUntraced(function* (
  primitives: readonly Primitive[],
  primitive: Primitive,
  request: ExecutionRequest & { readonly version: number },
  id: string,
) {
  const { version, ...asked } = request;
  const run = yield* preparedVersion(primitive, asked.name, version);
  return yield* runExecution(primitives, id, asked, { ...run, createOnly: true }).pipe(
    Effect.catchIf(isTaken, () => Effect.flatMap(loadExecution(id), (recorded) => answerOf(id, recorded))),
  );
});
