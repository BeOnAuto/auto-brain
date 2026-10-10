import { toolInWords } from '@beonauto/mcp';
import { plainNumber } from '@beonauto/operations';

import type { DeliveryBecause, DeliveryEnded, DeliveryStarted } from '../runs/run-events.ts';

const becauseWords: Readonly<Record<DeliveryBecause, string>> = {
  timed_out: 'the tool server did not answer in time',
  too_large: 'its arguments are larger than a call may send',
  unworkable: 'its arguments cannot be rendered for this request',
  tool_not_offered: 'this server no longer offers the tool it names',
  tool_error: 'the tool answered with an error',
  server_failure: 'the tool server failed',
  lost: 'the server stopped before it learned how the attempt ended',
};

export function throughTheTool({ server, tool }: Pick<DeliveryStarted, 'server' | 'tool'>): string {
  return `through ${toolInWords({ server, tool })}`;
}

export function deliveryStarted(fact: Pick<DeliveryStarted, 'number' | 'server' | 'tool'>): string {
  return `Delivery attempt ${plainNumber(fact.number)} of the request started, ${throughTheTool(fact)}.`;
}

export function deliveryEnded(fact: Pick<DeliveryEnded, 'number' | 'outcome' | 'because'>): string {
  const attempt = `Delivery attempt ${plainNumber(fact.number)}`;
  if (fact.outcome === 'delivered') {
    return `${attempt} was delivered.`;
  }
  const why = fact.because === undefined ? 'it could not be made' : becauseWords[fact.because];
  return fact.outcome === 'failed'
    ? `${attempt} failed, because ${why}; another follows on the schedule, unless it was the last.`
    : `${attempt} was refused, because ${why}, so it is not tried again.`;
}
