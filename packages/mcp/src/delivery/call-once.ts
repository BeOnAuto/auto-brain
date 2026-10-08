import { Result } from 'effect';

import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { bytesOf, cutAtCodePoint } from '../bounds/text-bytes.ts';
import { deliveryIdKey, executionIdKey } from '../calls/call-meta.ts';
import { takenSlot } from '../calls/server-slot.ts';
import { forwarded, type Forwarded } from '../calls/tool-calls.ts';
import type { ServerLink } from '../connections/server-links.ts';
import {
  deliveryBounds,
  failedWith,
  type DeliveryAccess,
  type DeliveryCall,
  type DeliveryCallEnded,
} from './delivery-bounds.ts';

function endedOf(done: Forwarded, { scrub }: Secrets): DeliveryCallEnded {
  const shown = scrub(done.resultJson ?? '');
  if (done.outcome === 'result') {
    return { outcome: 'result', text: cutAtCodePoint(shown, deliveryBounds.resultBytes), bytes: bytesOf(shown) };
  }
  const detail = done.message === '' ? shown : scrub(done.message);
  return {
    outcome: done.outcome,
    detail: cutToFailureBound(detail),
    retryAfterMs: done.retryAfterMs,
  };
}

export async function calledOnce(
  call: DeliveryCall,
  link: ServerLink,
  access: DeliveryAccess,
  signal: Readonly<AbortSignal>,
): Promise<DeliveryCallEnded> {
  const taken = await takenSlot(link);
  if (Result.isFailure(taken)) {
    return failedWith('server_failure', cutToFailureBound(access.secrets.scrub(taken.failure.message)));
  }
  const slot = taken.success;
  try {
    const done = await forwarded({
      slot,
      tool: call.reference.tool,
      input: call.input,
      meta: { [executionIdKey]: call.executionId, [deliveryIdKey]: call.deliveryId },
      callMs: Math.min(access.timing.callMs, deliveryBounds.callMs),
      longestRetryWaitMs: 0,
      signal,
    });
    return endedOf(done, access.secrets);
  } finally {
    await slot.release();
  }
}
