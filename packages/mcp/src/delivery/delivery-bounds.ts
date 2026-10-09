import type { Schema } from 'effect';

import type { NotOfferedBecause } from '../access/tool-not-offered.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import type { AnswerBlock } from '../bounds/result-text.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { CallOutcome } from '../calls/call-facts.ts';
import type { AnsweredFields } from '../calls/recorded-calls.ts';
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

interface AnsweredCall {
  readonly kind: 'answered';
  readonly fields: AnsweredFields;
  readonly durationMs: number;
  readonly detail: string;
  readonly retryAfterMs: number | null;
}

export type AnsweredOnce =
  | (AnsweredCall & { readonly outcome: 'result'; readonly answer: CallAnswer })
  | (AnsweredCall & { readonly outcome: Exclude<CallOutcome, 'result'> });

export interface UnopenedOnce {
  readonly kind: 'unopened';
  readonly because: 'mcp_server_failed';
  readonly detail: string;
}

export type CalledOnce =
  | { readonly kind: 'not_offered'; readonly because: NotOfferedBecause; readonly detail: string }
  | UnopenedOnce
  | AnsweredOnce;

export interface DeliveryAccess {
  readonly links: ReadonlyMap<string, ServerLink>;
  readonly secrets: Secrets;
  readonly timing: Timing;
}
