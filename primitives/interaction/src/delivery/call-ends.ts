import type { AnsweredOnce, CallAnswer } from '@beonauto/mcp';
import type { DeliveryBecause } from '@beonauto/specs';

const becauseOf = {
  tool_error: 'tool_error',
  server_failure: 'server_failure',
  timed_out: 'timed_out',
  cancelled: 'lost',
} as const satisfies Readonly<Record<Exclude<AnsweredOnce['outcome'], 'result'>, DeliveryBecause>>;

interface CallFailed {
  readonly because: (typeof becauseOf)[keyof typeof becauseOf];
  readonly retryAfterMs: number | null;
  readonly detail: string;
}

export type CallEnd = { readonly answered: CallAnswer } | { readonly failed: CallFailed };

export function endOfCall(called: AnsweredOnce): CallEnd {
  if (called.outcome === 'result') {
    return { answered: called.answer };
  }
  const { outcome, retryAfterMs, detail } = called;
  return { failed: { because: becauseOf[outcome], retryAfterMs, detail } };
}
