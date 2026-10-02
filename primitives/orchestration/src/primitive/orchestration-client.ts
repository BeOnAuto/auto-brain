import { setTimeout } from 'node:timers/promises';

import { NotFound, Unavailable } from '@beonauto/operations';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { Clock, Effect, type Scope } from 'effect';

import type { JsonObject } from '../dsl/json.ts';
import { defaultLongestNestedExecutionMs, type StartingRun, type WorkflowRun } from '../interpreter/workflow-run.ts';
import { makeThrottle } from '../notices/throttle.ts';
import { connectionOptionsOf, type TemporalSettings } from '../worker/temporal-settings.ts';
import { eventSignalName, workflowIdOf, workflowType } from '../workflow/activity-contract.ts';

export interface StartedRun {
  readonly workflowId: string;
  readonly runId: string;
}

export interface ExecutionWorkflow {
  readonly org: string;
  readonly brain: string;
  readonly spec: string;
  readonly executionId: string;
}

export interface OrchestrationClient {
  readonly mostDuration: number;
  readonly start: (run: StartingRun) => Effect.Effect<StartedRun, Unavailable>;
  readonly signal: (workflow: ExecutionWorkflow, event: JsonObject) => Effect.Effect<void, NotFound | Unavailable>;
}

export interface ClientOptions {
  readonly requestTimeout?: number;
  readonly longestNestedExecutionMs?: number;
}

export const startUnavailable = 'Temporal cannot start the workflow now; try again later';

export const eventUnavailable = 'Temporal cannot deliver the event now; try again later';

const mostReportedCharacters = 500;

const reportWindowMs = 60_000;

const callOutlivesAnswerMs = 1000;

type ReportFailure = (action: string, error: unknown) => Effect.Effect<void>;

interface TemporalCalls {
  readonly start: (run: WorkflowRun) => Promise<StartedRun>;
  readonly signal: (workflowId: string, event: JsonObject) => Promise<void>;
  readonly close: () => Promise<void>;
}

export const connectOrchestration = Effect.fnUntraced(function* (
  settings: TemporalSettings,
  options: ClientOptions = {},
): Effect.fn.Return<OrchestrationClient, never, Scope.Scope> {
  const temporal = yield* Effect.acquireRelease(
    Effect.sync(() => openTemporal(settings, options.requestTimeout ?? 10_000)),
    (opened) => Effect.promise(() => opened.close()),
  );
  const report = failureReports();
  const { longestNestedExecutionMs = defaultLongestNestedExecutionMs } = options;
  return {
    mostDuration: settings.mostDuration,
    start: (run) =>
      Effect.tryPromise({
        try: () => temporal.start({ ...run, mostDuration: settings.mostDuration, longestNestedExecutionMs }),
        catch: (error) => error,
      }).pipe(
        Effect.tapError((error) => report('start a workflow', error)),
        Effect.mapError(() => new Unavailable({ detail: startUnavailable })),
      ),
    signal: ({ org, brain, spec, executionId }, event) =>
      Effect.tryPromise({
        try: () => temporal.signal(workflowIdOf(org, brain, spec, executionId), event),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error): Effect.Effect<never, NotFound | Unavailable> =>
          error instanceof WorkflowNotFoundError
            ? Effect.fail(new NotFound({ detail: 'The execution has no workflow running' }))
            : Effect.andThen(
                report('deliver an event', error),
                Effect.fail(new Unavailable({ detail: eventUnavailable })),
              ),
        ),
      ),
  };
});

function failureReports(): ReportFailure {
  const throttle = makeThrottle(reportWindowMs);
  return (action, error) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const admission = throttle.admit(now);
      return admission.admitted
        ? Effect.logWarning(`Temporal could not ${action}`).pipe(
            Effect.annotateLogs({
              error: String(error).slice(0, mostReportedCharacters),
              suppressed: admission.suppressed,
            }),
          )
        : Effect.void;
    });
}

async function unanswered(requestTimeout: number): Promise<never> {
  await setTimeout(requestTimeout, undefined, { ref: false });
  throw new Error(`Temporal did not answer within ${requestTimeout} ms`);
}

function openTemporal(settings: TemporalSettings, requestTimeout: number): TemporalCalls {
  const connection = Connection.lazy(connectionOptionsOf(settings));
  const client = new Client({ connection, namespace: settings.namespace });
  const unsettled = new Set<Promise<unknown>>();
  const withinDeadline = <T>(request: () => Promise<T>): Promise<T> => {
    const answer = connection.withDeadline(Date.now() + requestTimeout + callOutlivesAnswerMs, request);
    const settled = Promise.allSettled([answer]);
    unsettled.add(settled);
    void settled.then(() => unsettled.delete(settled));
    return Promise.race([answer, unanswered(requestTimeout)]);
  };
  return {
    start: async (run) => {
      const { id, org, brain, spec } = run.execution;
      const { workflowId, firstExecutionRunId } = await withinDeadline(() =>
        client.workflow.start(workflowType, {
          taskQueue: settings.taskQueue,
          workflowId: workflowIdOf(org, brain, spec.name, id),
          args: [run],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowExecutionTimeout: run.mostDuration,
          memo: { org, brain, spec: spec.name, spec_version: spec.version, execution_id: id },
          staticSummary: `Execution ${id} of the workflow spec ${spec.name}`,
        }),
      );
      return { workflowId, runId: firstExecutionRunId };
    },
    signal: (workflowId, event) =>
      withinDeadline(() => client.workflow.getHandle(workflowId).signal(eventSignalName, event)),
    close: async () => {
      await Promise.all(unsettled);
      await connection.close();
    },
  };
}
