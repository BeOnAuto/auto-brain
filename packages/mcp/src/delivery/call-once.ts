import { cutToFailureBound } from '../bounds/call-bounds.ts';
import { answerOf } from '../bounds/result-text.ts';
import { answeredFields, type Recording } from '../calls/recorded-calls.ts';
import { forwarded, type Forwarded } from '../calls/tool-calls.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { boundedSlot, connectionBoundOf, takenWithin } from './connection-bound.ts';
import {
  deliveryBounds,
  type AnsweredOnce,
  type DeliveryAccess,
  type DeliveryCall,
  type UnopenedOnce,
} from './delivery-bounds.ts';

export function answeredOnce(done: Forwarded, durationMs: number, recording: Recording): AnsweredOnce {
  const { scrub } = recording;
  const answered = { kind: 'answered', fields: answeredFields(done, recording), durationMs } as const;
  const { outcome, message, retryAfterMs } = done;
  const shown = scrub(done.resultJson ?? '');
  if (outcome === 'result') {
    return { ...answered, outcome, answer: answerOf(shown), detail: '', retryAfterMs };
  }
  return { ...answered, outcome, detail: cutToFailureBound(message === '' ? shown : scrub(message)), retryAfterMs };
}

function unopened(detail: string): UnopenedOnce {
  return { kind: 'unopened', because: 'mcp_server_failed', detail: cutToFailureBound(detail) };
}

export async function calledOnce(
  call: DeliveryCall,
  link: ServerLink,
  access: DeliveryAccess,
  signal: Readonly<AbortSignal>,
): Promise<Forwarded | UnopenedOnce> {
  const connectionMs = connectionBoundOf(access.timing);
  const taken = await takenWithin(link, connectionMs);
  if ('late' in taken) {
    return unopened(`The MCP server ${call.reference.server} did not open a connection within ${connectionMs} ms`);
  }
  if ('failure' in taken) {
    return unopened(access.secrets.scrub(taken.failure.message));
  }
  const slot = boundedSlot(taken.slot, connectionMs);
  try {
    return await forwarded({
      slot,
      tool: call.reference.tool,
      input: call.input,
      meta: call.meta,
      callMs: Math.min(access.timing.callMs, deliveryBounds.callMs),
      longestRetryWaitMs: 0,
      signal,
    });
  } finally {
    await slot.release();
  }
}
