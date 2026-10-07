import type { DeliveryEvent, ExecutionDeferred } from '../execution/execution-events.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from '../presenting/event-data.ts';
import type { Account } from '../presenting/event-presenter.ts';
import type { RunWords } from '../primitive/primitive.ts';

interface Fact {
  readonly execution_id: string;
  readonly by: string;
}

export interface TypedAccount extends Account {
  readonly type: string;
}

export function deferralAccount(words: RunWords, event: ExecutionDeferred, fact: Fact): TypedAccount | undefined {
  const account = words.deferral(event.record);
  return account === undefined
    ? undefined
    : {
        type: words.deferralType,
        summary: account.summary,
        data: { ...fact, record_bytes: jsonBytesOf(event.record), ...account.data },
      };
}

function endedShown(event: Extract<DeliveryEvent, { readonly type: 'delivery_ended' }>) {
  const { outcome, status, because, retry_after_ms: wait, response_bytes: bytes, detail, duration_ms } = event;
  return {
    outcome,
    ...(status === undefined ? {} : { status }),
    ...(because === undefined ? {} : { because }),
    ...(wait === undefined ? {} : { retry_after_ms: wait }),
    ...(bytes === undefined ? {} : { response_bytes: bytes }),
    ...(detail === undefined ? {} : { detail: cutAtCodePoint(detail, mostDetailBytes) }),
    duration_ms,
  };
}

export function deliveryAccount(words: RunWords, event: DeliveryEvent, fact: Fact): TypedAccount {
  const shown =
    event.type === 'delivery_started'
      ? {
          channel: cutAtCodePoint(event.channel, mostNameBytes),
          target: cutAtCodePoint(event.target, mostNameBytes),
        }
      : endedShown(event);
  return { type: event.type, summary: words.delivery(event), data: { ...fact, number: event.number, ...shown } };
}
