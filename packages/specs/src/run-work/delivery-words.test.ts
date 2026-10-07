import { describe, expect, it } from 'vitest';

import type { DeliveryEndedFact } from '../execution/execution-commands.ts';
import type { DeliveryBecause } from '../execution/execution-events.ts';
import { deliveryEnded, deliveryStarted, statusInWords } from './delivery-words.ts';

const failed: DeliveryEndedFact = { type: 'delivery_ended', number: 2, outcome: 'failed', duration_ms: 10 };

describe('the words of a delivery', () => {
  it('say which attempt started and through which channel', () => {
    expect(deliveryStarted(1, 'approvals')).toBe(
      'Delivery attempt 1 of the request started, through the channel “approvals”.',
    );
  });

  it('say how an attempt ended, and whether another follows', () => {
    expect(deliveryEnded({ ...failed, outcome: 'delivered' })).toBe('Delivery attempt 2 was delivered.');
    expect(deliveryEnded({ ...failed, outcome: 'answered' })).toBe(
      'Delivery attempt 2 was delivered, and its receiver answered the request at once.',
    );
    expect(deliveryEnded({ ...failed, status: 503, because: 'status' })).toBe(
      'Delivery attempt 2 failed, because the receiver answered “service unavailable”; another follows on the schedule, unless it was the last.',
    );
    expect(deliveryEnded({ ...failed, outcome: 'refused', because: 'redirected', status: 307 })).toBe(
      'Delivery attempt 2 was refused, because the receiver sent it elsewhere, which a delivery never follows, so it is not tried again.',
    );
  });

  const reasons: ReadonlyArray<readonly [DeliveryBecause, string]> = [
    ['timed_out', 'the receiver did not answer in time'],
    ['unreachable', 'the receiver could not be reached'],
    ['untrusted_certificate', 'the certificate of the receiver is not one this server trusts'],
    ['not_https', 'its address is not a secure one'],
    ['too_large', 'it is larger than a delivery may send'],
    ['channel_not_offered', 'this server no longer offers its channel'],
    ['tool_error', 'the tool answered with an error'],
    ['server_failure', 'the tool server failed'],
    ['not_json', 'what came back could not be read as an answer'],
    ['answer_invalid', 'what came back does not fit the answer the request asks for'],
    ['lost', 'the server stopped before it learned how the attempt ended'],
  ];

  it.each(reasons)('say why an attempt failed when %s', (because, why) => {
    expect(deliveryEnded({ ...failed, because })).toContain(`because ${why};`);
  });
});

describe('a status a receiver answered, in words', () => {
  it.each([
    [429, '“too many requests”'],
    [404, '“not found”'],
    [204, 'that it took it'],
    [308, 'with a redirect'],
    [451, 'that it refuses the request'],
    [599, 'that it failed'],
    [0, 'in a way it should not'],
  ])('is %i written as %s, never as its number', (status, words) => {
    expect(statusInWords(status)).toBe(words);
  });

  it('is unknown words for an attempt that failed without a status', () => {
    expect(deliveryEnded(failed)).toContain('the receiver answered in a way it should not');
  });
});
