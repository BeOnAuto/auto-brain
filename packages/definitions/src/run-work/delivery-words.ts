import { toolInWords } from '@beonauto/mcp';
import { plainNumber } from '@beonauto/operations';

import type {
  DeliveryEnded,
  DeliveryFailedBecause,
  DeliveryRefusedBecause,
  DeliveryStarted,
} from '../runs/run-events.ts';

const becauseWords: Readonly<Record<DeliveryFailedBecause | DeliveryRefusedBecause, string>> = {
  timed_out: 'the tool server did not answer in time',
  too_large: 'its arguments are larger than a call may send',
  unworkable: 'its arguments cannot be rendered for this request',
  tool_not_offered: 'this server no longer offers the tool it names',
  tool_error: 'the tool answered with an error',
  arguments_refused: 'the tool server refused its arguments',
  server_failure: 'the tool server failed',
  lost: 'the server stopped before it learned how the attempt ended',
};

interface OnTheTool {
  readonly server: string;
  readonly tool: string;
}

export function throughTheTool({ server, tool }: OnTheTool): string {
  return `through ${toolInWords({ server, tool })}`;
}

export function deliveryStarted({ data }: DeliveryStarted): string {
  return `Delivery attempt ${plainNumber(data.number)} of the request started, ${throughTheTool(data)}.`;
}

export function deliveryEnded({ type, data }: DeliveryEnded): string {
  const attempt = `Delivery attempt ${plainNumber(data.number)}`;
  if (type === 'delivery_succeeded') {
    return `${attempt} was delivered.`;
  }
  return type === 'delivery_failed'
    ? `${attempt} failed, because ${becauseWords[data.because]}; another follows on the schedule, unless it was the last.`
    : `${attempt} was refused, because ${becauseWords[data.because]}, so it is not tried again.`;
}
