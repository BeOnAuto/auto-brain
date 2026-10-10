import type { DeliveryFailedBecause } from '@beonauto/definitions';
import type { AnsweredOnce, CallAnswer, CallAnswered, CallFailed, CallFailedBecause } from '@beonauto/mcp';

const becauseOf = {
  arguments_refused: 'arguments_refused',
  server_failure: 'server_failure',
  timed_out: 'timed_out',
  cancelled: 'lost',
} as const satisfies Readonly<Record<CallFailedBecause, DeliveryFailedBecause>>;

export interface CallFailure {
  readonly because: 'tool_error' | (typeof becauseOf)[CallFailedBecause];
  readonly retryAfterMs: number | null;
  readonly detail: string;
  readonly fields: CallAnswered | CallFailed;
}

export type CallEnd =
  | { readonly answered: CallAnswer; readonly fields: CallAnswered }
  | { readonly failed: CallFailure };

export function endOfCall(called: AnsweredOnce): CallEnd {
  if (called.outcome === 'result') {
    return { answered: called.answer, fields: called.answered };
  }
  const { retryAfterMs, detail } = called;
  if (called.outcome === 'tool_error') {
    return { failed: { because: 'tool_error', retryAfterMs, detail, fields: called.answered } };
  }
  return { failed: { because: becauseOf[called.outcome], retryAfterMs, detail, fields: called.failed } };
}
