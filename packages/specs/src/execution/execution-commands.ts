import type { Schema } from 'effect';

import type { ExecutionDeferred, ExecutionFinished } from './execution-events.ts';

export interface ExecutionRequest {
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface ExecutionStart extends ExecutionRequest {
  readonly type: 'start';
  readonly spec_version: number;
}

type WithoutFact<Event> = Event extends ExecutionFinished | ExecutionDeferred ? Omit<Event, 'by' | 'at'> : never;

export type ExecutionResult = WithoutFact<ExecutionFinished>;

export type ExecutionOutcome = WithoutFact<ExecutionFinished | ExecutionDeferred>;

export interface ExecutionFinish {
  readonly type: 'finish';
  readonly result: ExecutionOutcome;
}

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export interface ExecutionSettlement {
  readonly type: 'settle';
  readonly result: ExecutionResult;
  readonly at: string;
}

export type ExecutionCommand = ((ExecutionStart | ExecutionFinish) & CommandMetadata) | ExecutionSettlement;
