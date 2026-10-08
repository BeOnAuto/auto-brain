import { describe, expect, it } from 'vitest';

import type { DeliveryEndedFact } from '../execution/execution-commands.ts';
import type { DeliveryBecause } from '../execution/execution-events.ts';
import { deliveryEnded, deliveryStarted, throughTheTool } from './delivery-words.ts';

const failed: DeliveryEndedFact = { type: 'delivery_ended', number: 2, outcome: 'failed', duration_ms: 10 };

describe('the words of a delivery', () => {
  it('say which attempt started and through which tool of which server', () => {
    expect([
      throughTheTool({ server: 'chat', tool: 'post_message' }),
      deliveryStarted({ number: 1, server: 'chat', tool: 'post_message' }),
    ]).toEqual([
      'through the tool post_message of chat',
      'Delivery attempt 1 of the request started, through the tool post_message of chat.',
    ]);
  });

  it('say how an attempt ended, and whether another follows', () => {
    expect(deliveryEnded({ ...failed, outcome: 'delivered' })).toBe('Delivery attempt 2 was delivered.');
    expect(deliveryEnded({ ...failed, because: 'server_failure' })).toBe(
      'Delivery attempt 2 failed, because the tool server failed; another follows on the schedule, unless it was the last.',
    );
    expect(deliveryEnded({ ...failed, outcome: 'refused', because: 'too_large' })).toBe(
      'Delivery attempt 2 was refused, because its arguments are larger than a call may send, so it is not tried again.',
    );
  });

  const reasons: ReadonlyArray<readonly [DeliveryBecause, string]> = [
    ['timed_out', 'the tool server did not answer in time'],
    ['too_large', 'its arguments are larger than a call may send'],
    ['tool_not_offered', 'this server no longer offers the tool it names'],
    ['tool_error', 'the tool answered with an error'],
    ['server_failure', 'the tool server failed'],
    ['lost', 'the server stopped before it learned how the attempt ended'],
  ];

  it.each(reasons)('say why an attempt failed when %s', (because, why) => {
    expect(deliveryEnded({ ...failed, because })).toContain(`because ${why};`);
  });

  it('say only that it could not be made for an attempt that failed without a reason', () => {
    expect(deliveryEnded(failed)).toContain('because it could not be made;');
  });
});
