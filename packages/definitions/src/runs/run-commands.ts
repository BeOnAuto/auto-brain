import type { CallLink } from '@beonauto/operations';
import type { Schema } from 'effect';

import type { StartingTrigger } from '../registry/definition-triggers.ts';
import type {
  CancelRequestKind,
  DeliveryEnded,
  DeliveryStarted,
  RunDeferred,
  RunFinished,
  ReplyRefused,
  ReplyTaken,
  ToolCallEnded,
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
  readonly called_by?: CallLink;
  readonly trigger?: StartingTrigger;
  readonly createOnly?: true;
}

export type RunResult = RunFinished;

export type RunOutcome = RunFinished | RunDeferred;

export type CallStartedFact = Omit<ToolCallStarted, 'data'> & {
  readonly data: Omit<ToolCallStarted['data'], 'number'> & { readonly number?: number };
};

export type ToolCallFact = CallStartedFact | ToolCallEnded;

export type DeliveryStartedFact = DeliveryStarted;

export type DeliveryEndedFact = DeliveryEnded;

export type OutboundCallFact = DeliveryStartedFact | DeliveryEndedFact;

export type ReplyFact = ReplyTaken | ReplyRefused;

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
  readonly runId: string;
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
