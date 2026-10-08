import type { Schema } from 'effect';

import type { StartingTrigger } from '../registry/spec-triggers.ts';
import type {
  CalledBy,
  CancelRequestKind,
  DeliveryEnded,
  DeliveryStarted,
  ExecutionDeferred,
  ExecutionFinished,
  ToolCallAnswered,
  ToolCallStarted,
} from './execution-events.ts';

export interface ExecutionRequest {
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface ExecutionStart extends ExecutionRequest {
  readonly type: 'start';
  readonly spec_version: number;
  readonly calls_tools: boolean;
  readonly finishes_later?: boolean;
  readonly depth?: number;
  readonly call_depth?: number;
  readonly called_by?: CalledBy;
  readonly trigger?: StartingTrigger;
  readonly createOnly?: true;
}

type CopiedFromTheStart =
  | 'by'
  | 'at'
  | 'primitive'
  | 'name'
  | 'spec_version'
  | 'depth'
  | 'call_depth'
  | 'called_by'
  | 'trigger';

type WithoutFact<Event> = Event extends ExecutionFinished | ExecutionDeferred ? Omit<Event, CopiedFromTheStart> : never;

export type ExecutionResult = WithoutFact<ExecutionFinished>;

export type ExecutionOutcome = WithoutFact<ExecutionFinished | ExecutionDeferred>;

export type CallStartedFact = Omit<ToolCallStarted, 'by' | 'at' | 'number'>;

export type CallAnsweredFact = Omit<ToolCallAnswered, 'by' | 'at'>;

export type ToolCallFact = (CallStartedFact & { readonly number?: number }) | CallAnsweredFact;

type OfTheRun = 'by' | 'at' | 'primitive' | 'name' | 'spec_version';

export type DeliveryStartedFact = Omit<DeliveryStarted, OfTheRun>;

export type DeliveryEndedFact = Omit<DeliveryEnded, OfTheRun>;

export type OutboundCallFact = DeliveryStartedFact | DeliveryEndedFact;

export interface InterruptedAttempt {
  readonly type: 'execution_interrupted';
}

export interface ExecutionFinish {
  readonly type: 'finish';
  readonly result: ExecutionOutcome | InterruptedAttempt;
}

export interface ExecutionToolCall {
  readonly type: 'tool_call';
  readonly fact: ToolCallFact;
}

export interface ExecutionOutboundCall {
  readonly type: 'outbound_call';
  readonly fact: OutboundCallFact;
}

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export interface ExecutionSettlement extends CommandMetadata {
  readonly type: 'settle';
  readonly result: ExecutionResult;
}

export interface ExecutionCancel extends CommandMetadata {
  readonly type: 'cancel';
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly byItsCaller?: true;
}

export type ExecutionCommand =
  | ((ExecutionStart | ExecutionFinish | ExecutionToolCall | ExecutionOutboundCall) & CommandMetadata)
  | ExecutionSettlement
  | ExecutionCancel;
