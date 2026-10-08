import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { CallOutcome } from '../calls/call-facts.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { ToolReference } from '../names/tool-reference.ts';

export const deliveryBounds = { connectionMs: 10_000, callMs: 30_000, resultBytes: 4096 } as const;

export interface DeliveryCall {
  readonly org: string;
  readonly brain: string;
  readonly executionId: string;
  readonly deliveryId: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
}

type CallFailure = Exclude<CallOutcome, 'result'> | 'not_offered';

export type DeliveryCallEnded =
  | { readonly outcome: 'result'; readonly text: string; readonly bytes: number }
  | { readonly outcome: CallFailure; readonly detail: string; readonly retryAfterMs: number | null };

export interface DeliveryAccess {
  readonly links: ReadonlyMap<string, ServerLink>;
  readonly allowed: readonly ToolReference[] | null;
  readonly secrets: Secrets;
  readonly timing: Timing;
}

export function failedWith(outcome: CallFailure, detail: string): DeliveryCallEnded {
  return { outcome, detail, retryAfterMs: null };
}
