import type { Schema } from 'effect';

import type { DeclarableReason } from './rejection.ts';

export type RejectionReason = 'invalid_input' | 'forbidden' | DeclarableReason;

export interface Issue {
  readonly detail: string;
  readonly pointer: string;
}

export interface Succeeded {
  readonly status: 'succeeded';
  readonly output: Schema.JsonObject;
}

export interface Rejected {
  readonly status: 'rejected';
  readonly reason: RejectionReason;
  readonly detail: string;
  readonly issues?: readonly Issue[];
}

export interface Failed {
  readonly status: 'failed';
  readonly incident: string;
}

export interface Cancelled {
  readonly status: 'cancelled';
}

export type Outcome = Succeeded | Rejected | Failed;

export type Settled = Outcome | Cancelled;

export function succeeded(output: Schema.JsonObject): Succeeded {
  return { status: 'succeeded', output };
}

export function rejected(reason: RejectionReason, detail: string, issues?: readonly Issue[]): Rejected {
  return issues === undefined ? { status: 'rejected', reason, detail } : { status: 'rejected', reason, detail, issues };
}

export function failed(incident: string): Failed {
  return { status: 'failed', incident };
}

export function cancelled(): Cancelled {
  return { status: 'cancelled' };
}
