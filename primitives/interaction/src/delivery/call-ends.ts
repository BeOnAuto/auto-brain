import type { CallAnswer, DeliveryCallEnded } from '@beonauto/mcp';

const becauseOf = {
  tool_error: 'tool_error',
  server_failure: 'server_failure',
  timed_out: 'timed_out',
  cancelled: 'lost',
  not_offered: 'channel_not_offered',
} as const;

type CallFailure = Exclude<DeliveryCallEnded, { readonly outcome: 'result' }>;

interface CallFailed {
  readonly because: (typeof becauseOf)[CallFailure['outcome']];
  readonly retryAfterMs: number | null;
  readonly detail: string;
}

interface CallAnswered extends CallAnswer {
  readonly bytes: number;
}

export type CallEnd = { readonly answered: CallAnswered } | { readonly failed: CallFailed };

export function endOfCall(ended: DeliveryCallEnded): CallEnd {
  if (ended.outcome === 'result') {
    const { content, structuredContent, bytes } = ended;
    return { answered: { content, bytes, ...(structuredContent === undefined ? {} : { structuredContent }) } };
  }
  return { failed: { because: becauseOf[ended.outcome], retryAfterMs: ended.retryAfterMs, detail: ended.detail } };
}
