import type { DeliveryEndedFact } from '@beonauto/definitions';
import type { AnsweredOnce, CalledOnce } from '@beonauto/mcp';

import type { DeliveringRecord } from '../run/request-record.ts';
import { endOfCall } from './call-ends.ts';
import { keptOf } from './sent-messages.ts';

export type AttemptEnd = Omit<DeliveryEndedFact, 'type' | 'number' | 'duration_ms'>;

export interface RequestAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}

function detailOf(detail: string) {
  return detail === '' ? {} : { detail };
}

function endOfAnswer(called: AnsweredOnce, record: DeliveringRecord): AttemptEnd {
  const end = endOfCall(called);
  if ('answered' in end) {
    return { outcome: 'delivered', ...called.fields, ...keptOf(record, end.answered) };
  }
  const { because, retryAfterMs, detail } = end.failed;
  return {
    outcome: 'failed',
    because,
    ...(retryAfterMs === null ? {} : { retry_after_ms: retryAfterMs }),
    ...detailOf(detail),
    ...called.fields,
  };
}

export function endOf(called: CalledOnce, record: DeliveringRecord): AttemptEnd {
  if (called.kind === 'answered') {
    return endOfAnswer(called, record);
  }
  const { refused, detail } = called;
  return {
    outcome: 'failed',
    because: refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure',
    ...detailOf(detail),
  };
}
