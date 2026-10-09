import { Schema } from 'effect';

import type { RunOutput } from '../../dispatch/run-output.ts';
import { RunCountSchema, StepCauseSchema, StepOutcomeSchema, withExecutionId, withRunId } from './format-six.ts';
import { CallKeySchema, InstantSchema, TimerPurposeSchema } from './format-two.ts';

export const FormatsOneToSixSchema = Schema.Literals([1, 2, 3, 4, 5, 6]);

const keyed = { key: Schema.String, at: InstantSchema };

const ReceiptSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('started'), ...keyed }),
  Schema.Struct({ kind: Schema.Literal('timer_fired'), ...keyed }),
  Schema.Struct({
    kind: Schema.Literal('call_answered'),
    ...keyed,
    status: Schema.Literals(['succeeded', 'rejected', 'failed', 'unreachable']),
    rejection: Schema.optionalKey(
      Schema.Struct({ kind: Schema.optionalKey(Schema.String), because: Schema.optionalKey(Schema.String) }),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal('event_received'), ...keyed, eventType: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('event_offered'), ...keyed, eventType: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('cancel_requested'),
    ...keyed,
    cancel: Schema.optionalKey(
      Schema.Struct({ by: Schema.String, kind: Schema.Literals(['requested', 'deadline', 'parent_ended']) }),
    ),
  }),
]);

const StepSchema = Schema.Struct({
  reference: Schema.String,
  run: RunCountSchema,
  outcome: StepOutcomeSchema,
  name: Schema.String,
  times: RunCountSchema,
  caused_by: StepCauseSchema,
  error: Schema.optionalKey(Schema.Struct({ type: Schema.String, title: Schema.optionalKey(Schema.String) })),
  waits_for: Schema.optionalKey(Schema.Literals(['call', 'timer', 'event'])),
  child: Schema.optionalKey(Schema.String),
});

const EarlierStepSchema = Schema.Struct({ reference: Schema.String, run: RunCountSchema, outcome: StepOutcomeSchema });

const ResumedSchema = Schema.Struct({ reference: Schema.String, run: RunCountSchema, times: RunCountSchema });

const PatchOperationSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('add'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('replace'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('remove'), path: Schema.String }),
]);

const IssueSchema = Schema.Struct({ detail: Schema.String, pointer: Schema.String });

const settledBy = { by: Schema.optionalKey(Schema.NonEmptyString) };

const recorded = { record: Schema.optionalKey(Schema.JsonObject), ...settledBy };

const rejected = { status: Schema.Literal('rejected'), detail: Schema.String, ...recorded };

const UnavailableKindSchema = Schema.Literals([
  'model_not_offered',
  'tool_not_offered',
  'mcp_server_failed',
  'tools_unfinished',
  'rebuilding',
  'requests_full',
]);

const UnavailableBecauseSchema = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'mcp_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'not_testable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'server_failed',
  'model_unavailable',
  'run_bound',
  'no_answer',
]);

const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
  'oversized',
]);

const SettlementSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json, ...recorded }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('invalid_input'),
    issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('unavailable'),
    kind: Schema.optionalKey(UnavailableKindSchema),
    because: Schema.optionalKey(UnavailableBecauseSchema),
  }),
  Schema.Struct({ ...rejected, reason: Schema.Literal('conflict'), kind: Schema.optionalKey(ConflictKindSchema) }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('cancelled'),
    kind: Schema.Literals(['requested', 'deadline', 'overrun', 'parent_ended']),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('unanswered'),
    kind: Schema.Literals(['expired', 'undelivered']),
  }),
  Schema.Struct({ status: Schema.Literal('failed'), incident: Schema.optionalKey(Schema.String), ...settledBy }),
]);

const OutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('arm_timer'),
    executionId: Schema.NonEmptyString,
    timerId: Schema.NonEmptyString,
    dueAt: InstantSchema,
    purpose: TimerPurposeSchema,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('cancel_timer'),
    executionId: Schema.NonEmptyString,
    timerId: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('start_call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: Schema.Json,
    longestMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal('cancel_call'),
    key: CallKeySchema,
    reason: Schema.optionalKey(Schema.Literals(['deadline', 'parent_ended'])),
  }),
  Schema.Struct({ kind: Schema.Literal('arm_listener'), key: CallKeySchema, filters: Schema.Array(Schema.JsonObject) }),
  Schema.Struct({ kind: Schema.Literal('cancel_listener'), key: CallKeySchema }),
  Schema.Struct({ kind: Schema.Literal('emit_event'), key: CallKeySchema, event: Schema.JsonObject }),
  Schema.Struct({ kind: Schema.Literal('settle'), executionId: Schema.NonEmptyString, settlement: SettlementSchema }),
]);

type OutputOfFormatSix = typeof OutputSchema.Type;

export const EventOfFormatsOneToSixSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  format: FormatsOneToSixSchema,
  receipt: ReceiptSchema,
  steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
  resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(OutputSchema),
});

function outputWithRunId(output: OutputOfFormatSix): RunOutput {
  if (output.kind === 'arm_timer') {
    return withRunId(output);
  }
  if (output.kind === 'cancel_timer') {
    return withRunId(output);
  }
  if (output.kind === 'settle') {
    return withRunId(output);
  }
  return { ...output, key: withRunId(output.key) };
}

function outputWithExecutionId(output: RunOutput): unknown {
  return 'key' in output ? { ...output, key: withExecutionId(output.key) } : withExecutionId(output);
}

function eventWithRunIds({ outputs, ...event }: typeof EventOfFormatsOneToSixSchema.Type) {
  return { ...event, outputs: outputs.map((output) => outputWithRunId(output)) };
}

function eventWithExecutionIds({ outputs, ...event }: { readonly outputs: readonly RunOutput[] }): unknown {
  return { ...event, outputs: outputs.map((output) => outputWithExecutionId(output)) };
}

export const eventNamesOfFormatsOneToSix = { current: eventWithRunIds, written: eventWithExecutionIds };

export const SnapshotOfFormatsOneToSixSchema = Schema.Struct({
  format: FormatsOneToSixSchema,
  executionId: Schema.NonEmptyString,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  historyBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Json,
});

function snapshotWithRunId(snapshot: typeof SnapshotOfFormatsOneToSixSchema.Type) {
  return withRunId(snapshot);
}

function snapshotWithExecutionId(snapshot: { readonly runId: string }): unknown {
  return withExecutionId(snapshot);
}

export const snapshotNamesOfFormatsOneToSix = { current: snapshotWithRunId, written: snapshotWithExecutionId };
