import type { Schema } from 'effect';

import type { StartingTrigger } from '../registry/definition-triggers.ts';
import type {
  CalledBy,
  CancelRequestKind,
  DeliveryEnded,
  DeliveryStarted,
  RunDeferred,
  RunFinished,
  ReplyRefused,
  ReplyTaken,
  ToolCallAnswered,
  ToolCallStarted,
} from './run-events.ts';

export interface RunRequest {
  readonly definition_type: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface RunStart extends RunRequest {
  readonly type: 'start';
  readonly definition_version: number;
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
  | 'definition_type'
  | 'name'
  | 'definition_version'
  | 'depth'
  | 'call_depth'
  | 'called_by'
  | 'trigger';

type WithoutFact<Event> = Event extends RunFinished | RunDeferred ? Omit<Event, CopiedFromTheStart> : never;

export type RunResult = WithoutFact<RunFinished>;

export type RunOutcome = WithoutFact<RunFinished | RunDeferred>;

export type CallStartedFact = Omit<ToolCallStarted, 'by' | 'at' | 'number'>;

export type CallAnsweredFact = Omit<ToolCallAnswered, 'by' | 'at'>;

export type ToolCallFact = (CallStartedFact & { readonly number?: number }) | CallAnsweredFact;

type OfTheRun = 'by' | 'at' | 'definition_type' | 'name' | 'definition_version';

export type DeliveryStartedFact = Omit<DeliveryStarted, OfTheRun>;

export type DeliveryEndedFact = Omit<DeliveryEnded, OfTheRun>;

export type OutboundCallFact = DeliveryStartedFact | DeliveryEndedFact;

export type ReplyTakenFact = Omit<ReplyTaken, OfTheRun>;

export type ReplyRefusedFact = Omit<ReplyRefused, OfTheRun>;

export type ReplyFact = ReplyTakenFact | ReplyRefusedFact;

export interface InterruptedAttempt {
  readonly type: 'run_interrupted';
}

export interface RunFinish {
  readonly type: 'finish';
  readonly result: RunOutcome | InterruptedAttempt;
}

export interface RunToolCall {
  readonly type: 'tool_call';
  readonly fact: ToolCallFact;
}

export interface RunOutboundCall {
  readonly type: 'outbound_call';
  readonly fact: OutboundCallFact;
}

export interface RunReply {
  readonly type: 'reply';
  readonly fact: ReplyFact;
}

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export interface RunSettlement extends CommandMetadata {
  readonly type: 'settle';
  readonly result: RunResult;
}

export interface RunCancel extends CommandMetadata {
  readonly type: 'cancel';
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly byItsCaller?: true;
}

export type RunCommand =
  | ((RunStart | RunFinish | RunToolCall | RunOutboundCall | RunReply) & CommandMetadata)
  | RunSettlement
  | RunCancel;
