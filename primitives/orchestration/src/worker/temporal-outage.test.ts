import { describe, expect, it } from 'vitest';

import { isLostTemporal, makeOutageWatch } from './temporal-outage.ts';

const unavailable = { errorCode: 'Unavailable' };

function reported(message: string) {
  return { level: 'WARN', message, context: {} };
}

describe('a Temporal outage', () => {
  it('is one warning when it starts, at most one a minute with a count while it lasts, and one line when it ends', () => {
    const watch = makeOutageWatch();

    const lines = [
      watch.recovered(0),
      watch.troubled(1000, unavailable),
      watch.troubled(2000, unavailable),
      watch.troubled(60_999, unavailable),
      watch.troubled(61_000, unavailable),
      watch.troubled(62_000, unavailable),
      watch.recovered(90_000),
      watch.recovered(91_000),
      watch.troubled(95_000, unavailable),
    ];

    expect(lines).toStrictEqual([
      undefined,
      { level: 'WARN', message: 'The workflow worker lost Temporal', context: unavailable },
      undefined,
      undefined,
      {
        level: 'WARN',
        message: 'The workflow worker still cannot reach Temporal',
        context: { ...unavailable, lost_for_ms: 60_000, suppressed: 2 },
      },
      undefined,
      { level: 'INFO', message: 'The workflow worker reached Temporal again', context: { lost_for_ms: 89_000 } },
      undefined,
      { level: 'WARN', message: 'The workflow worker lost Temporal', context: unavailable },
    ]);
  });

  it('shows in the retries of gRPC calls and in network errors, and in nothing else', () => {
    expect(
      [
        'Temporal reported: gRPC call poll_workflow_task_queue retried 6 times',
        'Temporal reported: Network error while sending worker heartbeat',
        'Temporal reported: Failing workflow task',
        'The workflow worker lost Temporal',
      ].map((message) => isLostTemporal(reported(message))),
    ).toStrictEqual([true, true, false, false]);
  });
});
