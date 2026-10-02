import type { Schema } from 'effect';

import type { ConflictKind } from './conflict.ts';
import { cappedIssues, type Issue } from './issue.ts';
import type { DeclarableReason } from './rejection.ts';

export type RejectionReason = 'forbidden' | DeclarableReason;

export interface Succeeded {
  readonly status: 'succeeded';
  readonly output: Schema.JsonObject;
}

export interface Rejected {
  readonly status: 'rejected';
  readonly reason: RejectionReason;
  readonly detail: string;
  readonly issues?: readonly Issue[];
  readonly conflict?: ConflictKind;
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

export function rejected(
  reason: RejectionReason,
  detail: string,
  issues?: readonly Issue[],
  conflict?: ConflictKind,
): Rejected {
  const described: Rejected =
    issues === undefined
      ? { status: 'rejected', reason, detail }
      : { status: 'rejected', reason, detail, issues: cappedIssues(issues) };
  return conflict === undefined ? described : { ...described, conflict };
}

export function failed(incident: string): Failed {
  return { status: 'failed', incident };
}

export function cancelled(): Cancelled {
  return { status: 'cancelled' };
}
