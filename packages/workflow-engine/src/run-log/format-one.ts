import { Schema } from 'effect';

import { CallKeySchema } from '../executor/call-key.ts';
import { ReceivedEventSchema } from '../inbox/received-event.ts';
import { DslErrorSchema } from '../machine/dsl-error.ts';
import { InstantSchema } from '../machine/instant.ts';
import { RunLimitsSchema } from '../machine/run-input.ts';
import { newRun, RunOutcomeSchema } from '../machine/run-state.ts';
import { TimerPurposeSchema } from '../timers/timer-id.ts';
import type { OlderFormat } from './state-format.ts';

type Fields = Readonly<Record<string, unknown>>;

const ValueIdSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const VariablesSchema = Schema.Record(Schema.String, ValueIdSchema);

const FrameReference = Schema.suspend((): Schema.Codec<unknown, unknown> => FrameSchema);

const ListCursorSchema = Schema.Struct({
  pointer: Schema.String,
  position: Schema.Int,
  data: ValueIdSchema,
  variables: VariablesSchema,
  current: Schema.NullOr(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('running'), task: FrameReference }),
      Schema.Struct({ kind: Schema.Literal('yielding'), timer: Schema.String }),
    ]),
  ),
});

const BranchSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('running'), task: FrameReference }),
  Schema.Struct({ state: Schema.Literal('finished'), output: ValueIdSchema, flow: Schema.String }),
  Schema.Struct({ state: Schema.Literal('failed'), error: DslErrorSchema }),
]);

const FrameBodySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('list'), list: ListCursorSchema }),
  Schema.Struct({
    kind: Schema.Literal('for'),
    items: ValueIdSchema,
    index: Schema.Int,
    data: ValueIdSchema,
    list: Schema.NullOr(ListCursorSchema),
  }),
  Schema.Struct({ kind: Schema.Literal('fork'), compete: Schema.Boolean, branches: Schema.Array(BranchSchema) }),
  Schema.Struct({
    kind: Schema.Literal('try'),
    attempt: Schema.Int,
    startedAt: InstantSchema,
    phase: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('trying'),
        list: ListCursorSchema,
        attemptLimit: Schema.NullOr(Schema.String),
      }),
      Schema.Struct({ kind: Schema.Literal('backing_off'), timer: Schema.String, error: DslErrorSchema }),
      Schema.Struct({ kind: Schema.Literal('recovering'), list: ListCursorSchema }),
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal('wait'), timer: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: ValueIdSchema,
    label: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('listen'), consumed: Schema.Array(ValueIdSchema) }),
]);

const FrameSchema = Schema.Struct({
  reference: Schema.String,
  run: Schema.Int,
  rawInput: ValueIdSchema,
  input: ValueIdSchema,
  variables: VariablesSchema,
  timeout: Schema.NullOr(Schema.String),
  body: FrameBodySchema,
});

const FormatOneSchema = Schema.Struct({
  executionId: Schema.String,
  status: Schema.Literals(['new', 'running', 'ended']),
  workflow: Schema.NullOr(Schema.Struct({ document: Schema.JsonObject, input: ValueIdSchema })),
  attributes: Schema.JsonObject,
  limits: RunLimitsSchema,
  startedAt: InstantSchema,
  lastInputAt: InstantSchema,
  inputs: Schema.Int,
  random: Schema.Struct({ seed: Schema.Int, draws: Schema.Int }),
  runs: Schema.Record(Schema.String, Schema.Int),
  timers: Schema.Struct({
    next: Schema.Int,
    armed: Schema.Record(
      Schema.String,
      Schema.Struct({ purpose: TimerPurposeSchema, reference: Schema.String, dueAt: InstantSchema }),
    ),
  }),
  calls: Schema.Record(Schema.String, CallKeySchema),
  inbox: Schema.Struct({
    waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: Schema.Int })),
    waitingBytes: Schema.Int,
    receivedIds: Schema.Array(Schema.String),
    received: Schema.Int,
    receivedBytes: Schema.Int,
    overflow: Schema.NullOr(DslErrorSchema),
  }),
  heldBytes: Schema.Int,
  historyBytes: Schema.Int,
  stepsWithoutWaiting: Schema.Int,
  cancelRequested: Schema.Boolean,
  machine: Schema.Struct({
    values: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Json, bytes: Schema.Int })),
    nextValue: ValueIdSchema,
    context: ValueIdSchema,
    root: Schema.NullOr(FrameReference),
  }),
  outcome: Schema.NullOr(RunOutcomeSchema),
});

type FormatOne = typeof FormatOneSchema.Type;

type ArmedTimerOfFormatOne = FormatOne['timers']['armed'][string];

const readFormatOne = Schema.decodeUnknownSync(FormatOneSchema, { onExcessProperty: 'error' });

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withFailuresOrdered(branches: readonly unknown[]): readonly unknown[] {
  return branches.map((branch, order) =>
    isFields(branch) && branch['state'] === 'failed' ? { ...branch, order } : branch,
  );
}

function withFrameFields(node: unknown, startedAt: number, context: number): unknown {
  if (Array.isArray(node)) {
    return node.map((item: unknown) => withFrameFields(item, startedAt, context));
  }
  if (!isFields(node)) {
    return node;
  }
  const walked = Object.fromEntries(
    Object.entries(node).map(([key, item]: readonly [string, unknown]) => [
      key,
      withFrameFields(item, startedAt, context),
    ]),
  );
  const branches = walked['branches'];
  const ordered = node['kind'] === 'fork' && Array.isArray(branches) ? { branches: withFailuresOrdered(branches) } : {};
  const frame = Object.hasOwn(node, 'rawInput') ? { startedAt, context } : {};
  return { ...walked, ...ordered, ...frame };
}

function upcastFormatOne(state: FormatOne): unknown {
  const { lastInputAt, machine, timers } = state;
  const armed = Object.fromEntries(
    Object.entries(timers.armed).map(([id, timer]: readonly [string, ArmedTimerOfFormatOne]) => [
      id,
      { ...timer, armedAt: Math.min(lastInputAt, timer.dueAt) },
    ]),
  );
  return {
    ...state,
    timers: { ...timers, armed },
    machine: { ...machine, root: withFrameFields(machine.root, lastInputAt, machine.context) },
  };
}

export const formatOne: OlderFormat = {
  format: 1,
  initial: newRun,
  read: (state) => readFormatOne(state),
  upcast: (state) => upcastFormatOne(readFormatOne(state)),
};
