import {
  CancelledKindSchema,
  ConflictKindSchema,
  IssueSchema,
  UnansweredKindSchema,
  UnavailableBecauseSchema,
  UnavailableKindSchema,
} from '@beonauto/operations';
import { Schema } from 'effect';

import type { BrainFunctionDefinition, WorkflowDefinition } from '../registry/spec.ts';
import { mostResultBytes } from './recorded-size.ts';

export const ExecutionRejectionSchema = Schema.Union([
  Schema.Struct({ reason: Schema.Literal('invalid_input'), detail: Schema.String, issues: Schema.Array(IssueSchema) }),
  Schema.Struct({
    reason: Schema.Literal('unavailable'),
    detail: Schema.String,
    kind: Schema.optionalKey(
      UnavailableKindSchema.annotate({
        description:
          'What the run could not use, when known: model_not_offered for a model this server does not offer, tool_not_offered for a tool it does not offer, mcp_server_failed for a tool server that failed before any tool was called, tools_unfinished for a run that called tools and could not finish, so that a tool may have changed something, and rebuilding for a recall function whose view is still being built, which trying again later may resolve',
      }),
    ),
    because: Schema.optionalKey(
      UnavailableBecauseSchema.annotate({
        description:
          'Why. With model_not_offered: provider_not_configured when its provider is not set up on this server while others are, model_not_allowed when it is outside the models the operator allows. With tool_not_offered: mcp_server_not_configured, tool_not_allowed or tool_not_listed. With mcp_server_failed: failing, rate_limited, unreachable or key_refused. With tools_unfinished: server_failed, model_unavailable, run_bound or no_answer',
      }),
    ),
  }),
  Schema.Struct({
    reason: Schema.Literal('conflict'),
    detail: Schema.String,
    kind: Schema.optionalKey(
      ConflictKindSchema.annotate({
        description:
          'What clashed, when it is known: unworkable for a definition that cannot run as written, such as a computation function whose program raised an error, gave no output or more than one, or did more work than a run may do, which only changing the definition puts right; stalled for a recall function whose view stopped at an event its fold could not take, which a corrected version rebuilds; tools_called for a workflow whose step met a run of a function that may have called tools, which is not run again under its id; oversized for a workflow whose output is larger than a run may record',
      }),
    ),
  }),
  Schema.Struct({
    reason: Schema.Literal('cancelled'),
    detail: Schema.String,
    kind: CancelledKindSchema.annotate({
      description:
        'Why the run was cancelled: requested when someone allowed to change the brain asked for it with cancel_execution; deadline when the step that waited for it ran out of time; overrun when a workflow ran as long as a workflow may run; parent_ended when the run that waited for it ended first, or its branch of a race lost',
    }),
  }),
  Schema.Struct({
    reason: Schema.Literal('unanswered'),
    detail: Schema.String,
    kind: UnansweredKindSchema.annotate({
      description:
        'Why nobody answered what the run asked: expired when its request expired before an answer came; undelivered when a notification could not be delivered in any of its attempts',
    }),
  }),
]).annotate({ description: 'Why the run was rejected, that it was cancelled, or that nobody answered it' });

export type ExecutionRejection = typeof ExecutionRejectionSchema.Type;

export const RunSchema = Schema.Struct({
  execution_id: Schema.String.annotate({ description: 'The run id, a UUID' }),
  primitive: Schema.String.annotate({ description: 'The API type identifier of the definition' }),
  name: Schema.String.annotate({ description: 'The definition name' }),
  spec_version: Schema.Int.annotate({ description: 'The definition version that ran' }),
  status: Schema.Literals(['started', 'succeeded', 'rejected', 'failed']).annotate({
    description:
      'started while it runs, while work it started finishes later, or when it never finished; then succeeded, rejected or failed',
  }),
  output: Schema.optionalKey(
    Schema.Json.annotate({
      description: `The result, when the run succeeded: with the record, at most ${mostResultBytes} bytes as JSON in UTF-8`,
    }),
  ),
  rejection: Schema.optionalKey(ExecutionRejectionSchema),
  started_at: Schema.String.annotate({ description: 'When the run started, in ISO 8601 UTC' }),
  started_by: Schema.String.annotate({ description: 'The id of the caller who started the run' }),
  finished_at: Schema.optionalKey(Schema.String.annotate({ description: 'When the run finished, in ISO 8601 UTC' })),
}).annotate({ identifier: 'Run', description: 'One run of a definition with an input, and how it ended' });

export type Run = typeof RunSchema.Type;

export type FunctionRun = Run & Pick<BrainFunctionDefinition, 'primitive'>;

export type WorkflowRun = Run & Pick<WorkflowDefinition, 'primitive'>;

const functionTypes: ReadonlySet<string> = new Set(['inference', 'interaction', 'computation', 'recollection']);

export function isFunctionRun(run: Run): run is FunctionRun {
  return functionTypes.has(run.primitive);
}

export function isWorkflowRun(run: Run): run is WorkflowRun {
  return run.primitive === 'orchestration';
}

export type ExecutionRecord = Omit<Run, 'execution_id'>;

export const RunDetailSchema = Schema.Struct({
  ...RunSchema.fields,
  record: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description:
        'What the runtime adapter recorded: of the run that succeeded, of what a rejected run did before it was rejected, such as the tokens a model call used, or of the work it started that finishes later',
    }),
  ),
}).annotate({
  identifier: 'RunDetail',
  description: 'One run of a definition with an input, how it ended, and what its runtime adapter recorded',
});

export type RunDetail = typeof RunDetailSchema.Type;
