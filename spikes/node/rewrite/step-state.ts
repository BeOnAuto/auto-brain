import type { Variables } from '../../../primitives/orchestration/src/dsl/expressions.ts';
import type { Json, JsonArray, JsonObject } from '../../../primitives/orchestration/src/dsl/json.ts';
import type {
  SettleRequest,
  SpecCall,
  SpecCallResult,
} from '../../../primitives/orchestration/src/interpreter/host.ts';
import type { TaskOutcome } from '../../../primitives/orchestration/src/interpreter/invocation.ts';
import type { DslError } from '../../../primitives/orchestration/src/interpreter/raised-error.ts';
import type { RunOutcome } from '../../../primitives/orchestration/src/interpreter/settlement.ts';
import type { WorkflowRun } from '../../../primitives/orchestration/src/interpreter/workflow-run.ts';

export type Decide = (state: RunSnapshot, input: RunInput) => Decision;

export interface Decision {
  readonly state: RunSnapshot;
  readonly outputs: readonly RunOutput[];
}

export type TimerId = string;

export type CallKey = string;

export type FramePath = readonly number[];

export type RunInput =
  | { readonly kind: 'started'; readonly run: WorkflowRun; readonly at: number }
  | { readonly kind: 'timer_fired'; readonly timer: TimerId; readonly at: number }
  | { readonly kind: 'call_answered'; readonly key: CallKey; readonly result: SpecCallResult; readonly at: number }
  | { readonly kind: 'call_unreachable'; readonly key: CallKey; readonly detail: string; readonly at: number }
  | { readonly kind: 'event_received'; readonly event: JsonObject; readonly at: number }
  | { readonly kind: 'cancel_requested'; readonly at: number };

export type RunOutput =
  | { readonly kind: 'arm_timer'; readonly timer: TimerId; readonly fireAt: number; readonly summary: string }
  | { readonly kind: 'cancel_timer'; readonly timer: TimerId }
  | { readonly kind: 'start_call'; readonly key: CallKey; readonly call: SpecCall; readonly longestMs: number }
  | { readonly kind: 'cancel_call'; readonly key: CallKey }
  | { readonly kind: 'settle'; readonly request: SettleRequest };

export interface RunSnapshot {
  readonly run: WorkflowRun;
  readonly startedAt: number;
  readonly lastInputAt: number;
  readonly status: { readonly kind: 'running' } | { readonly kind: 'ended'; readonly outcome: RunOutcome };
  readonly root: TaskFrame;
  readonly context: Json;
  readonly runs: Readonly<Record<string, number>>;
  readonly stepsWithoutWaiting: number;
  readonly meter: MeterState;
  readonly inbox: InboxState;
  readonly timers: Readonly<Record<TimerId, TimerOwner>>;
  readonly calls: Readonly<Record<CallKey, FramePath>>;
  readonly nextTimer: number;
}

export interface MeterState {
  readonly activation: number;
  readonly work: number;
  readonly tasks: number;
}

export interface InboxState {
  readonly waiting: readonly JsonObject[];
  readonly waitingBytes: number;
  readonly deliveredIds: readonly string[];
  readonly received: number;
  readonly receivedBytes: number;
  readonly overflow: DslError | undefined;
}

export interface TimerOwner {
  readonly frame: FramePath;
  readonly purpose: 'wait' | 'timeout' | 'retry-delay' | 'attempt-limit' | 'deadline' | 'yield';
}

export interface ListFrame {
  readonly kind: 'list';
  readonly pointer: string;
  readonly position: number;
  readonly data: Json;
  readonly variables: Variables;
  readonly current: TaskFrame | undefined;
}

export interface TaskFrame {
  readonly kind: 'task';
  readonly reference: string;
  readonly run: number;
  readonly rawInput: Json;
  readonly input: Json;
  readonly descriptor: JsonObject;
  readonly variables: Variables;
  readonly timeout: TimerId | undefined;
  readonly body: BodyFrame;
}

export type BodyFrame =
  | { readonly kind: 'do'; readonly list: ListFrame }
  | {
      readonly kind: 'for';
      readonly items: JsonArray;
      readonly index: number;
      readonly data: Json;
      readonly list: ListFrame | undefined;
    }
  | {
      readonly kind: 'fork';
      readonly compete: boolean;
      readonly branches: readonly BranchState[];
    }
  | {
      readonly kind: 'try';
      readonly attempt: number;
      readonly startedAt: number;
      readonly phase: TryPhase;
    }
  | { readonly kind: 'wait'; readonly timer: TimerId }
  | { readonly kind: 'call'; readonly key: CallKey }
  | {
      readonly kind: 'listen';
      readonly filtersLeft: number;
      readonly consumed: readonly JsonObject[];
      readonly deliveredWhenWaiting: number;
    }
  | { readonly kind: 'yielding'; readonly timer: TimerId };

export type BranchState =
  | { readonly kind: 'running'; readonly task: TaskFrame }
  | { readonly kind: 'finished'; readonly outcome: TaskOutcome }
  | { readonly kind: 'failed'; readonly error: DslError };

export type TryPhase =
  | { readonly kind: 'trying'; readonly list: ListFrame; readonly attemptLimit: TimerId | undefined }
  | { readonly kind: 'backing-off'; readonly timer: TimerId; readonly error: DslError }
  | { readonly kind: 'recovering'; readonly list: ListFrame; readonly caught: JsonObject };
