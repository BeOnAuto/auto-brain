import { describe, expect, it } from 'vitest';

import type { DeliveryFailedBecause, DeliveryRefusedBecause } from '../runs/run-events.ts';
import { deliveryEnded, deliveryStarted, throughTheTool } from './delivery-words.ts';

function failedBecause(because: DeliveryFailedBecause) {
  return { type: 'delivery_failed', data: { number: 2, because, duration_ms: 10 } } as const;
}

function refusedBecause(because: DeliveryRefusedBecause) {
  return { type: 'delivery_refused', data: { number: 2, because, duration_ms: 0 } } as const;
}

describe('the words of a delivery', () => {
  it('say which attempt started and through which tool of which server', () => {
    expect([
      throughTheTool({ server: 'chat', tool: 'post_message' }),
      deliveryStarted({
        type: 'delivery_started',
        data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
      }),
    ]).toEqual([
      'through the post message tool of chat',
      'Delivery attempt 1 of the request started, through the post message tool of chat.',
    ]);
  });

  it('say how an attempt ended, and whether another follows', () => {
    const delivered = {
      type: 'delivery_succeeded',
      data: {
        number: 2,
        result_bytes: 20,
        result_sha256: 'b'.repeat(64),
        content_kept: true,
        duration_ms: 10,
        jsonrpc_id: 2,
      },
    } as const;

    expect([
      deliveryEnded(delivered),
      deliveryEnded(failedBecause('server_failure')),
      deliveryEnded(refusedBecause('too_large')),
    ]).toEqual([
      'Delivery attempt 2 was delivered.',
      'Delivery attempt 2 failed, because the tool server failed; another follows on the schedule, unless it was the last.',
      'Delivery attempt 2 was refused, because its arguments are larger than a call may send, so it is not tried again.',
    ]);
  });
});

describe('the words of a delivery that did not land', () => {
  const failures: ReadonlyArray<readonly [DeliveryFailedBecause, string]> = [
    ['timed_out', 'the tool server did not answer in time'],
    ['tool_not_offered', 'this server no longer offers the tool it names'],
    ['tool_error', 'the tool answered with an error'],
    ['arguments_refused', 'the tool server refused its arguments'],
    ['server_failure', 'the tool server failed'],
    ['lost', 'the server stopped before it learned how the attempt ended'],
  ];

  it.each(failures)('say why an attempt failed when %s', (because, why) => {
    expect(deliveryEnded(failedBecause(because))).toContain(`because ${why};`);
  });

  it('say why an attempt was refused when its arguments cannot be rendered', () => {
    expect(deliveryEnded(refusedBecause('unworkable'))).toContain(
      'because its arguments cannot be rendered for this request,',
    );
  });
});
