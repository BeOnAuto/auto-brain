import type { Schema } from 'effect';

import type { ExecutionDeferred, ExecutionFinished, ToolCallEvent } from './execution-events.ts';

export interface ExecutionRequest {
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface ExecutionStart extends ExecutionRequest {
  readonly type: 'start';
  readonly spec_version: number;
  readonly calls_tools: boolean;
  readonly depth?: number;
  readonly createOnly?: true;
}

type WithoutFact<Event> = Event extends ExecutionFinished | ExecutionDeferred | ToolCallEvent
  ? Omit<Event, 'by' | 'at' | 'primitive' | 'name' | 'spec_version' | 'depth'>
  : never;

export type ExecutionResult = WithoutFact<ExecutionFinished>;

export type ExecutionOutcome = WithoutFact<ExecutionFinished | ExecutionDeferred>;

export type ToolCallFact = WithoutFact<ToolCallEvent>;

export interface ExecutionFinish {
  readonly type: 'finish';
  readonly result: ExecutionOutcome;
}

export interface ExecutionToolCall {
  readonly type: 'tool_call';
  readonly fact: ToolCallFact;
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

export type ExecutionCommand =
  | ((ExecutionStart | ExecutionFinish | ExecutionToolCall) & CommandMetadata)
  | ExecutionSettlement;
