import { Result, Schema } from 'effect';

import type { Decider } from '../../../packages/operations/src/index.ts';

const RunInputSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('start'), stepMs: Schema.Number, timeoutMs: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('call_answered'), key: Schema.String, output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('timer_fired'), timer: Schema.String }),
]);

const RunOutputSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('start_call'), key: Schema.String, stepMs: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('arm_timer'), timer: Schema.String, fireAt: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('cancel_timer'), timer: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('cancel_call'), key: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('settle'), outcome: Schema.Literals(['succeeded', 'timed_out']) }),
]);

const RunEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('input_consumed'),
    messageId: Schema.String,
    at: Schema.Number,
    ignored: Schema.Boolean,
    input: RunInputSchema,
  }),
  Schema.Struct({ type: Schema.Literal('output_produced'), output: RunOutputSchema }),
]);

export type RunInput = typeof RunInputSchema.Type;

export type RunOutput = typeof RunOutputSchema.Type;

export type RunEvent = typeof RunEventSchema.Type;

export interface RunCommand {
  readonly executionId: string;
  readonly messageId: string;
  readonly at: number;
  readonly input: RunInput;
}

export interface PositionedOutput {
  readonly position: number;
  readonly output: RunOutput;
}

export interface RunState {
  readonly phase: 'new' | 'calling' | 'succeeded' | 'timed_out';
  readonly key: string | undefined;
  readonly timer: string | undefined;
  readonly consumed: ReadonlySet<string>;
  readonly outputs: readonly PositionedOutput[];
  readonly transcript: readonly string[];
  readonly events: number;
}

export function runStreamOf(executionId: string): string {
  return `owf-run:${executionId}`;
}

export function callKeyOf(executionId: string): string {
  return `${executionId}/do/0/call#1`;
}

export function timeoutTimerOf(key: string): string {
  return `timeout:${key}`;
}

const initialState: RunState = {
  phase: 'new',
  key: undefined,
  timer: undefined,
  consumed: new Set(),
  outputs: [],
  transcript: [],
  events: 0,
};

function describe(event: RunEvent): string {
  if (event.type === 'output_produced') {
    return `out:${event.output.kind}${event.output.kind === 'settle' ? `=${event.output.outcome}` : ''}`;
  }
  return `in:${event.input.kind}${event.ignored ? '(ignored)' : ''}`;
}

function phaseAfter(state: RunState, event: RunEvent): RunState['phase'] {
  if (event.type !== 'input_consumed' || event.ignored) {
    return state.phase;
  }
  const next: Readonly<Record<RunInput['kind'], RunState['phase']>> = {
    start: 'calling',
    call_answered: 'succeeded',
    timer_fired: 'timed_out',
  };
  return next[event.input.kind];
}

function evolve(state: RunState, event: RunEvent): RunState {
  const position = state.events + 1;
  const output = event.type === 'output_produced' ? event.output : undefined;
  return {
    phase: phaseAfter(state, event),
    key: output?.kind === 'start_call' ? output.key : state.key,
    timer: output?.kind === 'arm_timer' ? output.timer : state.timer,
    consumed: event.type === 'input_consumed' ? new Set([...state.consumed, event.messageId]) : state.consumed,
    outputs: output === undefined ? state.outputs : [...state.outputs, { position, output }],
    transcript: [...state.transcript, describe(event)],
    events: position,
  };
}

function produced(output: RunOutput): RunEvent {
  return { type: 'output_produced', output };
}

function reactions(command: RunCommand, state: RunState): readonly RunEvent[] | undefined {
  const { input, at, executionId } = command;
  if (input.kind === 'start' && state.phase === 'new') {
    const key = callKeyOf(executionId);
    return [
      produced({ kind: 'start_call', key, stepMs: input.stepMs }),
      produced({ kind: 'arm_timer', timer: timeoutTimerOf(key), fireAt: at + input.timeoutMs }),
    ];
  }
  if (
    input.kind === 'call_answered' &&
    state.phase === 'calling' &&
    input.key === state.key &&
    state.timer !== undefined
  ) {
    return [produced({ kind: 'cancel_timer', timer: state.timer }), produced({ kind: 'settle', outcome: 'succeeded' })];
  }
  if (
    input.kind === 'timer_fired' &&
    state.phase === 'calling' &&
    input.timer === state.timer &&
    state.key !== undefined
  ) {
    return [produced({ kind: 'cancel_call', key: state.key }), produced({ kind: 'settle', outcome: 'timed_out' })];
  }
  return undefined;
}

export const decisions = { made: 0 };

function decide(command: RunCommand, state: RunState): Result.Result<readonly RunEvent[], never> {
  decisions.made += 1;
  if (state.consumed.has(command.messageId)) {
    return Result.succeed([]);
  }
  const outputs = reactions(command, state);
  const consumed: RunEvent = {
    type: 'input_consumed',
    messageId: command.messageId,
    at: command.at,
    ignored: outputs === undefined,
    input: command.input,
  };
  return Result.succeed([consumed, ...(outputs ?? [])]);
}

export const runDecider: Decider<RunState, RunCommand, RunEvent> = {
  initialState,
  evolve,
  decide,
  eventSchema: RunEventSchema,
};
