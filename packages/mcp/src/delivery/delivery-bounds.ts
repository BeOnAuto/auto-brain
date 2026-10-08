import type { Schema } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { AnswerBlock } from '../bounds/result-text.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { CallOutcome } from '../calls/call-facts.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { ToolReference } from '../names/tool-reference.ts';

export const deliveryBounds = { connectionMs: 10_000, callMs: 30_000 } as const;

export interface DeliveryCall {
  readonly org: string;
  readonly brain: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
}

export interface CallAnswer {
  readonly content: readonly AnswerBlock[];
  readonly structuredContent?: Schema.Json;
}

type CallFailure = Exclude<CallOutcome, 'result'> | 'not_offered';

export type DeliveryCallEnded =
  | (CallAnswer & { readonly outcome: 'result'; readonly bytes: number })
  | { readonly outcome: CallFailure; readonly detail: string; readonly retryAfterMs: number | null };

export interface DeliveryAccess {
  readonly links: ReadonlyMap<string, ServerLink>;
  readonly secrets: Secrets;
  readonly timing: Timing;
}

export function failedWith(outcome: CallFailure, detail: string): DeliveryCallEnded {
  return { outcome, detail, retryAfterMs: null };
}
