import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughPartner } from '../testing/index.ts';

const minute = 60_000;

const someText: unknown = expect.any(String);

describe('a delivery that fails for a while', () => {
  it('is tried again on the schedule, a minute after a 5xx, with the same webhook-id', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    receiver.answerWith({ status: 503 });

    await brain.performDue(askedAt);
    const tooSoon = await brain.performDue(Date.now() + minute - 5000);
    await brain.performDue(Date.now() + minute + 5000);

    const [first, second] = receiver.received();
    expect(tooSoon).toBe(0);
    expect(receiver.received()).toHaveLength(2);
    expect(second?.headers['webhook-id']).toBe(first?.headers['webhook-id']);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });

  it('honours the wait a 429 asks for within the schedule', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    receiver.answerWith({ status: 429, headers: { 'retry-after': '120' } });

    await brain.performDue(askedAt);
    const afterTheSchedule = await brain.performDue(Date.now() + minute + 5000);
    const afterTheWait = await brain.performDue(Date.now() + 2 * minute + 5000);

    expect([afterTheSchedule, afterTheWait, receiver.received().length]).toEqual([0, 1, 2]);
  });

  it('stays open after five failed attempts, delivered no more, until it expires', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    receiver.answerEveryWith({ status: 500 });

    await brain.performEach([0, 1, 2, 3, 4, 5].map((step) => askedAt + step * 20 * minute));

    expect(receiver.received()).toHaveLength(5);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 5, standing: 'undelivered' });
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
  });
});

describe('a delivery the receiver refuses', () => {
  it.each([
    ['a 4xx', { status: 404 }],
    ['a redirect', { status: 307, headers: { location: 'https://elsewhere.example.com/' } }],
  ] as const)('is not tried again after %s, and the request waits for its answer', async (_case, answer) => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    receiver.answerWith(answer);

    await brain.performDue(askedAt);
    await brain.performDue(askedAt + 30 * minute);

    expect(receiver.received()).toHaveLength(1);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'undelivered' });
  });
});

describe('a request nobody answered in time', () => {
  it('ends its run unanswered as expired, a final result for its id', async () => {
    const { brain, askedAt } = await askedThroughPartner({ expires: 'PT1H' });

    await brain.performDue(askedAt + 61 * minute);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
    });
    expect(await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unanswered',
      kind: 'expired',
    });
    expect(await brain.firstOpen()).toBeUndefined();
  });
});

describe('a notification delivered by webhook', () => {
  it('succeeds once a delivery lands, with an empty output', async () => {
    const { brain, askedAt } = await askedThroughPartner({ notification: true });

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: someText } },
    });
  });

  it('ends unanswered as undelivered when its delivery is refused', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ notification: true });
    receiver.answerWith({ status: 410 });

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'undelivered' } },
    });
  });
});
