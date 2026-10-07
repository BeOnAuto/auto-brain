import type { Secrets } from '../bounds/secrets.ts';
import { bytesOf, cutAtCodePoint } from '../bounds/text-bytes.ts';
import { serverSlot } from '../calls/server-slot.ts';
import { forwarded, type Forwarded } from '../calls/tool-calls.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { connectionBoundOf, takenWithin } from './connection-bound.ts';
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
    detail: cutAtCodePoint(detail, deliveryBounds.detailBytes),
    retryAfterMs: done.retryAfterMs,
  };
}

export async function calledOnce(
  call: DeliveryCall,
  link: ServerLink,
  access: DeliveryAccess,
  signal: Readonly<AbortSignal>,
): Promise<DeliveryCallEnded> {
  const connectionMs = connectionBoundOf(access.timing);
  const taken = await takenWithin(link, connectionMs);
  if ('late' in taken) {
    return failedWith(
      'timed_out',
      `The MCP server ${call.reference.server} did not open a connection within ${connectionMs} ms`,
    );
  }
  if ('failure' in taken) {
    return failedWith('server_failure', access.secrets.scrub(taken.failure.message));
  }
  const slot = serverSlot(link, taken.connection);
  try {
    const done = await forwarded({
      slot,
      tool: call.reference.tool,
      input: call.input,
      executionId: call.executionId,
      deliveryId: call.deliveryId,
      callMs: Math.min(access.timing.callMs, deliveryBounds.callMs),
      longestRetryWaitMs: 0,
      signal,
    });
    return endedOf(done, access.secrets);
  } finally {
    await slot.release();
  }
}
