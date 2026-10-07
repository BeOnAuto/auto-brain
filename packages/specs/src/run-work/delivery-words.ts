import { plainNumber, quoted } from '@beonauto/operations';

import type { DeliveryBecause, DeliveryEnded } from '../execution/execution-events.ts';

const statusWords: ReadonlyMap<number, string> = new Map([
  [400, 'bad request'],
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [404, 'not found'],
  [405, 'method not allowed'],
  [408, 'request timeout'],
  [409, 'conflict'],
  [410, 'gone'],
  [413, 'content too large'],
  [415, 'unsupported media type'],
  [422, 'unprocessable content'],
  [429, 'too many requests'],
  [500, 'internal server error'],
  [501, 'not implemented'],
  [502, 'bad gateway'],
  [503, 'service unavailable'],
  [504, 'gateway timeout'],
]);

const classWords: readonly (readonly [number, string])[] = [
  [200, 'that it took it'],
  [300, 'with a redirect'],
  [400, 'that it refuses the request'],
  [500, 'that it failed'],
];

export function statusInWords(status: number): string {
  const known = statusWords.get(status);
  if (known !== undefined) {
    return `“${known}”`;
  }
  return classWords.findLast(([least]) => status >= least)?.[1] ?? 'in a way it should not';
}

const becauseWords: Readonly<Record<Exclude<DeliveryBecause, 'status'>, string>> = {
  timed_out: 'the receiver did not answer in time',
  unreachable: 'the receiver could not be reached',
  untrusted_certificate: 'the certificate of the receiver is not one this server trusts',
  redirected: 'the receiver sent it elsewhere, which a delivery never follows',
  not_https: 'its address is not a secure one',
  too_large: 'it is larger than a delivery may send',
  channel_not_offered: 'this server no longer offers its channel',
  tool_error: 'the tool answered with an error',
  server_failure: 'the tool server failed',
  not_json: 'what came back could not be read as an answer',
  answer_invalid: 'what came back does not fit the answer the request asks for',
  lost: 'the server stopped before it learned how the attempt ended',
};

function whyOf({ because, status }: Pick<DeliveryEnded, 'because' | 'status'>): string {
  if (because === undefined || because === 'status') {
    return `the receiver answered ${statusInWords(status ?? 0)}`;
  }
  return becauseWords[because];
}

export function deliveryStarted(number: number, channel: string): string {
  return `Delivery attempt ${plainNumber(number)} of the request started, through the channel ${quoted(channel)}.`;
}

export function deliveryEnded(fact: Pick<DeliveryEnded, 'number' | 'outcome' | 'because' | 'status'>): string {
  const attempt = `Delivery attempt ${plainNumber(fact.number)}`;
  if (fact.outcome === 'delivered') {
    return `${attempt} was delivered.`;
  }
  if (fact.outcome === 'answered') {
    return `${attempt} was delivered, and its receiver answered the request at once.`;
  }
  return fact.outcome === 'failed'
    ? `${attempt} failed, because ${whyOf(fact)}; another follows on the schedule, unless it was the last.`
    : `${attempt} was refused, because ${whyOf(fact)}, so it is not tried again.`;
}
