import { outboundCallRecorder } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { noChannels } from '../channels/channel-settings.ts';
import { defineAnswerInteraction } from '../requests/answer-interaction.ts';
import { askedRunId, askedThroughPartner } from '../testing/index.ts';

const minute = 60_000;

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

describe('an attempt the server stopped in', () => {
  it('ends as lost once its bound passed, and the next attempt follows on the schedule', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    await Effect.runPromise(
      outboundCallRecorder(brain.ledger.service)(
        address,
        { type: 'delivery_started', number: 1, channel: 'partner', target: 'ada' },
        { causationId: null, correlationId: askedRunId },
      ),
    );

    const whileInFlight = await brain.performDue(askedAt + 30_000);
    await brain.performDue(Date.now() + minute + 1000);
    const lost = await brain.firstOpen();
    await brain.performDue(Date.now() + 2 * minute + 2000);

    expect(whileInFlight).toBe(0);
    expect(lost).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(receiver.received()).toHaveLength(1);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });
});

describe('an attempt two hosts make at once', () => {
  it('is made by the host whose start is recorded first, and the other sends nothing', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    const items = await brain.dueItems(askedAt);

    await brain.performAll([...items, ...items], askedAt);

    expect(receiver.received()).toHaveLength(1);
  });
});

describe('a due request whose run has ended, or whose channel is gone', () => {
  it('sends nothing for a run answered since it was read as due', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    const items = await brain.dueItems(askedAt);
    await brain.call(defineAnswerInteraction(noChannels), { execution_id: askedRunId, answer: { choice: 'approve' } });

    await brain.performAll(items, askedAt);

    expect(receiver.received()).toEqual([]);
  });

  it('fails each attempt as a channel no longer offered, and the request stays open', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner();
    const withoutChannels = brain.dueWith(noChannels);

    await brain.performAll(await brain.dueItems(askedAt, withoutChannels), askedAt);

    expect(receiver.received()).toEqual([]);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(await Effect.runPromise(withoutChannels.nextDueAt(askedAt))).toBeGreaterThan(askedAt + minute - 1000);
  });
});
