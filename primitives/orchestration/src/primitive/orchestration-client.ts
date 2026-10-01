import { NotFound, Unavailable } from '@beonauto/operations';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { Effect, type Scope } from 'effect';

import type { JsonObject } from '../dsl/json.ts';
import type { WorkflowRun } from '../interpreter/workflow-run.ts';
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
  readonly start: (run: WorkflowRun) => Effect.Effect<StartedRun, Unavailable>;
  readonly signal: (workflow: ExecutionWorkflow, event: JsonObject) => Effect.Effect<void, NotFound | Unavailable>;
}

export interface ClientOptions {
  readonly requestTimeout?: number;
}

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
  return {
    start: (run) =>
      Effect.tryPromise({
        try: () => temporal.start(run),
        catch: (error) => new Unavailable({ detail: `Temporal could not start the workflow: ${String(error)}` }),
      }),
    signal: ({ org, brain, spec, executionId }, event) =>
      Effect.tryPromise({
        try: () => temporal.signal(workflowIdOf(org, brain, spec, executionId), event),
        catch: (error) =>
          error instanceof WorkflowNotFoundError
            ? new NotFound({ detail: 'The execution has no workflow running' })
            : new Unavailable({ detail: `Temporal could not deliver the event: ${String(error)}` }),
      }),
  };
});

function openTemporal(settings: TemporalSettings, requestTimeout: number): TemporalCalls {
  const connection = Connection.lazy(connectionOptionsOf(settings));
  const client = new Client({ connection, namespace: settings.namespace });
  const withinDeadline = <T>(request: () => Promise<T>): Promise<T> =>
    connection.withDeadline(Date.now() + requestTimeout, request);
  return {
    start: async (run) => {
      const { id, org, brain, spec } = run.execution;
      const { workflowId, firstExecutionRunId } = await withinDeadline(() =>
        client.workflow.start(workflowType, {
          taskQueue: settings.taskQueue,
          workflowId: workflowIdOf(org, brain, spec.name, id),
          args: [run],
          workflowIdConflictPolicy: 'USE_EXISTING',
          memo: { org, brain, spec: spec.name, spec_version: spec.version, execution_id: id },
          staticSummary: `Execution ${id} of the workflow spec ${spec.name}`,
        }),
      );
      return { workflowId, runId: firstExecutionRunId };
    },
    signal: (workflowId, event) =>
      withinDeadline(() => client.workflow.getHandle(workflowId).signal(eventSignalName, event)),
    close: () => connection.close(),
  };
}
