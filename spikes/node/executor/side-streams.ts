import { Result, Schema } from 'effect';

import type { Decider } from '../../../packages/operations/src/index.ts';

const JobEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('job_started'), at: Schema.Number, attempt: Schema.Number, by: Schema.String }),
  Schema.Struct({ type: Schema.Literal('job_finished'), at: Schema.Number, output: Schema.Json }),
  Schema.Struct({ type: Schema.Literal('job_cancelled'), at: Schema.Number }),
]);

export type JobEvent = typeof JobEventSchema.Type;

export type JobCommand =
  | { readonly kind: 'start'; readonly at: number; readonly by: string; readonly restart: boolean }
  | { readonly kind: 'finish'; readonly at: number; readonly output: Schema.Json }
  | { readonly kind: 'cancel'; readonly at: number };

export interface JobState {
  readonly attempt: number;
  readonly startedBy: string | undefined;
  readonly output: Schema.Json | undefined;
  readonly finished: boolean;
  readonly cancelled: boolean;
  readonly transcript: readonly string[];
}

export function jobStreamOf(key: string): string {
  return `owf-job:${key}`;
}

function evolveJob(state: JobState, event: JobEvent): JobState {
  const transcript = [
    ...state.transcript,
    event.type === 'job_started' ? `job_started#${event.attempt} by ${event.by}` : event.type,
  ];
  if (event.type === 'job_started') {
    return { ...state, attempt: event.attempt, startedBy: event.by, transcript };
  }
  return event.type === 'job_finished'
    ? { ...state, finished: true, output: event.output, transcript }
    : { ...state, cancelled: true, transcript };
}

function decideJob(command: JobCommand, state: JobState): Result.Result<readonly JobEvent[], never> {
  if (command.kind === 'start') {
    const fresh = state.attempt === 0;
    const resumable = command.restart && !state.finished && !state.cancelled;
    return Result.succeed(
      fresh || resumable ? [{ type: 'job_started', at: command.at, attempt: state.attempt + 1, by: command.by }] : [],
    );
  }
  if (command.kind === 'finish') {
    return Result.succeed(state.finished ? [] : [{ type: 'job_finished', at: command.at, output: command.output }]);
  }
  return Result.succeed(state.finished || state.cancelled ? [] : [{ type: 'job_cancelled', at: command.at }]);
}

export const jobDecider: Decider<JobState, JobCommand, JobEvent> = {
  initialState: {
    attempt: 0,
    startedBy: undefined,
    output: undefined,
    finished: false,
    cancelled: false,
    transcript: [],
  },
  evolve: evolveJob,
  decide: decideJob,
  eventSchema: JobEventSchema,
};

const WatermarkEventSchema = Schema.Struct({ type: Schema.Literal('dispatched'), through: Schema.Number });

type WatermarkEvent = typeof WatermarkEventSchema.Type;

export function watermarkStreamOf(executionId: string): string {
  return `owf-dispatch:${executionId}`;
}

export const watermarkDecider: Decider<number, number, WatermarkEvent> = {
  initialState: 0,
  evolve: (_, event) => event.through,
  decide: (through, current) => Result.succeed(through > current ? [{ type: 'dispatched', through }] : []),
  eventSchema: WatermarkEventSchema,
};
