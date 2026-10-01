import type { Schema } from 'effect';

import type { DeclarableReason } from './refusal.ts';

export type RefusalReason = 'invalid_input' | 'forbidden' | DeclarableReason;

export interface Issue {
  readonly detail: string;
  readonly pointer: string;
}

export interface Done {
  readonly status: 'done';
  readonly output: Schema.JsonObject;
}

export interface Refused {
  readonly status: 'refused';
  readonly reason: RefusalReason;
  readonly detail: string;
  readonly issues?: readonly Issue[];
}

export interface Faulted {
  readonly status: 'faulted';
  readonly incident: string;
}

export interface Stopped {
  readonly status: 'stopped';
}

export type Outcome = Done | Refused | Faulted;

export type Settled = Outcome | Stopped;

export function done(output: Schema.JsonObject): Done {
  return { status: 'done', output };
}

export function refused(reason: RefusalReason, detail: string, issues?: readonly Issue[]): Refused {
  return issues === undefined ? { status: 'refused', reason, detail } : { status: 'refused', reason, detail, issues };
}

export function faulted(incident: string): Faulted {
  return { status: 'faulted', incident };
}

export function stopped(): Stopped {
  return { status: 'stopped' };
}
