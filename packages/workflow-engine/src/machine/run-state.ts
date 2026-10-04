import { Schema } from 'effect';

import { CallKeySchema, type CallKey } from '../executor/call-key.ts';
import { ReceivedEventSchema, type ReceivedEvent } from '../inbox/received-event.ts';
import { TimerPurposeSchema, type TimerPurpose } from '../timers/timer-id.ts';
import { RunLimitsSchema, type RunLimits } from './run-input.ts';

export interface DslError {
  readonly type: string;
  readonly status: number;
  readonly instance: string;
  readonly title?: string;
  readonly detail?: string;
}

export type Variables = Readonly<Record<string, Schema.Json>>;

export interface ListCursor {
  readonly pointer: string;
  readonly position: number;
  readonly data: Schema.Json;
  readonly variables: Variables;
  readonly current: TaskFrame | null;
}

export type Branch =
  | { readonly state: 'running'; readonly task: TaskFrame }
  | { readonly state: 'finished'; readonly output: Schema.Json; readonly flow: string }
  | { readonly state: 'failed'; readonly error: DslError };

export type TryPhase =
  | { readonly kind: 'trying'; readonly list: ListCursor; readonly attemptLimit: string | null }
  | { readonly kind: 'backing_off'; readonly timer: string; readonly error: DslError }
  | { readonly kind: 'recovering'; readonly list: ListCursor };

export type FrameBody =
  | { readonly kind: 'list'; readonly list: ListCursor }
  | {
      readonly kind: 'for';
      readonly items: readonly Schema.Json[];
      readonly index: number;
      readonly data: Schema.Json;
      readonly list: ListCursor | null;
    }
  | { readonly kind: 'fork'; readonly compete: boolean; readonly branches: readonly Branch[] }
  | { readonly kind: 'try'; readonly attempt: number; readonly startedAt: number; readonly phase: TryPhase }
  | { readonly kind: 'wait'; readonly timer: string }
  | { readonly kind: 'call'; readonly key: CallKey }
  | { readonly kind: 'listen'; readonly consumed: readonly Schema.JsonObject[] }
  | { readonly kind: 'yield'; readonly timer: string };

export interface TaskFrame {
  readonly reference: string;
  readonly run: number;
  readonly rawInput: Schema.Json;
  readonly input: Schema.Json;
  readonly variables: Variables;
  readonly timeout: string | null;
  readonly body: FrameBody;
}

export interface MachineState {
  readonly context: Schema.Json;
  readonly root: TaskFrame | null;
}

export type RunOutcome =
  | { readonly kind: 'completed'; readonly output: Schema.Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number }
  | { readonly kind: 'overran'; readonly milliseconds: number };

export interface ArmedTimer {
  readonly purpose: TimerPurpose;
  readonly reference: string;
}

export interface WaitingEvent {
  readonly event: ReceivedEvent;
  readonly bytes: number;
}

export interface InboxState {
  readonly waiting: readonly WaitingEvent[];
  readonly waitingBytes: number;
  readonly receivedIds: readonly string[];
  readonly received: number;
  readonly receivedBytes: number;
  readonly overflow: DslError | null;
}

export interface RunState {
  readonly executionId: string;
  readonly status: 'new' | 'running' | 'ended';
  readonly workflow: { readonly document: Schema.JsonObject; readonly input: Schema.Json } | null;
  readonly attributes: Schema.JsonObject;
  readonly limits: RunLimits;
  readonly startedAt: number;
  readonly lastInputAt: number;
  readonly random: { readonly seed: number; readonly draws: number };
  readonly timers: { readonly next: number; readonly armed: Readonly<Record<string, ArmedTimer>> };
  readonly calls: {
    readonly runs: Readonly<Record<string, number>>;
    readonly open: Readonly<Record<string, CallKey>>;
  };
  readonly inbox: InboxState;
  readonly heldBytes: number;
  readonly stepsWithoutWaiting: number;
  readonly cancelRequested: boolean;
  readonly machine: MachineState;
  readonly outcome: RunOutcome | null;
}

const IntSchema = Schema.Int;

const VariablesSchema = Schema.Record(Schema.String, Schema.Json);

const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: IntSchema,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
});

const ListCursorSchema: Schema.Codec<ListCursor> = Schema.Struct({
  pointer: Schema.String,
  position: IntSchema,
  data: Schema.Json,
  variables: VariablesSchema,
  current: Schema.NullOr(Schema.suspend((): Schema.Codec<TaskFrame> => TaskFrameSchema)),
});

const BranchSchema: Schema.Codec<Branch> = Schema.Union([
  Schema.Struct({
    state: Schema.Literal('running'),
    task: Schema.suspend((): Schema.Codec<TaskFrame> => TaskFrameSchema),
  }),
  Schema.Struct({ state: Schema.Literal('finished'), output: Schema.Json, flow: Schema.String }),
  Schema.Struct({ state: Schema.Literal('failed'), error: DslErrorSchema }),
]);

const TryPhaseSchema: Schema.Codec<TryPhase> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('trying'), list: ListCursorSchema, attemptLimit: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('backing_off'), timer: Schema.String, error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('recovering'), list: ListCursorSchema }),
]);

const FrameBodySchema: Schema.Codec<FrameBody> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('list'), list: ListCursorSchema }),
  Schema.Struct({
    kind: Schema.Literal('for'),
    items: Schema.Array(Schema.Json),
    index: IntSchema,
    data: Schema.Json,
    list: Schema.NullOr(ListCursorSchema),
  }),
  Schema.Struct({ kind: Schema.Literal('fork'), compete: Schema.Boolean, branches: Schema.Array(BranchSchema) }),
  Schema.Struct({ kind: Schema.Literal('try'), attempt: IntSchema, startedAt: IntSchema, phase: TryPhaseSchema }),
  Schema.Struct({ kind: Schema.Literal('wait'), timer: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('call'), key: CallKeySchema }),
  Schema.Struct({ kind: Schema.Literal('listen'), consumed: Schema.Array(Schema.JsonObject) }),
  Schema.Struct({ kind: Schema.Literal('yield'), timer: Schema.String }),
]);

const TaskFrameSchema: Schema.Codec<TaskFrame> = Schema.Struct({
  reference: Schema.String,
  run: IntSchema,
  rawInput: Schema.Json,
  input: Schema.Json,
  variables: VariablesSchema,
  timeout: Schema.NullOr(Schema.String),
  body: FrameBodySchema,
});

const RunOutcomeSchema: Schema.Codec<RunOutcome> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed'), output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('raised'), error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('cancelled') }),
  Schema.Struct({ kind: Schema.Literal('broken'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('oversized'), bytes: IntSchema, most: IntSchema }),
  Schema.Struct({ kind: Schema.Literal('overran'), milliseconds: IntSchema }),
]);

export const RunStateSchema: Schema.Codec<RunState> = Schema.Struct({
  executionId: Schema.String,
  status: Schema.Literals(['new', 'running', 'ended']),
  workflow: Schema.NullOr(Schema.Struct({ document: Schema.JsonObject, input: Schema.Json })),
  attributes: Schema.JsonObject,
  limits: RunLimitsSchema,
  startedAt: IntSchema,
  lastInputAt: IntSchema,
  random: Schema.Struct({ seed: IntSchema, draws: IntSchema }),
  timers: Schema.Struct({
    next: IntSchema,
    armed: Schema.Record(Schema.String, Schema.Struct({ purpose: TimerPurposeSchema, reference: Schema.String })),
  }),
  calls: Schema.Struct({
    runs: Schema.Record(Schema.String, IntSchema),
    open: Schema.Record(Schema.String, CallKeySchema),
  }),
  inbox: Schema.Struct({
    waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: IntSchema })),
    waitingBytes: IntSchema,
    receivedIds: Schema.Array(Schema.String),
    received: IntSchema,
    receivedBytes: IntSchema,
    overflow: Schema.NullOr(DslErrorSchema),
  }),
  heldBytes: IntSchema,
  stepsWithoutWaiting: IntSchema,
  cancelRequested: Schema.Boolean,
  machine: Schema.Struct({ context: Schema.Json, root: Schema.NullOr(TaskFrameSchema) }),
  outcome: Schema.NullOr(RunOutcomeSchema),
});

export const newRun: RunState = {
  executionId: '',
  status: 'new',
  workflow: null,
  attributes: {},
  limits: { mostDurationMs: 1, longestCallMs: 1 },
  startedAt: 0,
  lastInputAt: 0,
  random: { seed: 0, draws: 0 },
  timers: { next: 1, armed: {} },
  calls: { runs: {}, open: {} },
  inbox: { waiting: [], waitingBytes: 0, receivedIds: [], received: 0, receivedBytes: 0, overflow: null },
  heldBytes: 0,
  stepsWithoutWaiting: 0,
  cancelRequested: false,
  machine: { context: {}, root: null },
  outcome: null,
};
