import type { Schema } from 'effect';

import type { ExecutionFinished } from './execution-events.ts';

export interface ExecutionRequest {
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface ExecutionStart extends ExecutionRequest {
  readonly type: 'start';
  readonly spec_version: number;
}

type WithoutFact<Event> = Event extends ExecutionFinished ? Omit<Event, 'by' | 'at'> : never;

export type ExecutionResult = WithoutFact<ExecutionFinished>;

export interface ExecutionFinish {
  readonly type: 'finish';
  readonly result: ExecutionResult;
}

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type ExecutionCommand = (ExecutionStart | ExecutionFinish) & CommandMetadata;
