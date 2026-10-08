import { serveFakeReceiver } from '@beonauto/outbound/testing';
import { outboundCallRecorder } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { noChannels } from '../channels/channel-settings.ts';
import { defineAnswerInteraction } from '../requests/answer-interaction.ts';
import {
  approvalDocument,
  askedRunId,
  askedThroughPartner,
  interactionHarness,
  webhookChannels,
} from '../testing/index.ts';

const minute = 60_000;

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

function firstDoing<Args extends readonly [unknown, unknown?]>(
  original: (...args: Args) => Promise<Response>,
  first: () => Promise<unknown>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    await first();
    return original(...args);
  };
}

describe('a notification whose attempts fail', () => {
  it('waits for the next attempt after one that failed, and ends undelivered once the fifth failed', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ notification: true });
    receiver.answerEveryWith({ status: 503 });

    await brain.performDue(askedAt);
    const afterTheFirst = await brain.runOf(askedRunId);
    await brain.performEach([1, 2, 3, 4].map((step) => askedAt + step * 20 * minute));

    expect(afterTheFirst).toMatchObject({ output: { status: 'started' } });
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'undelivered' } },
    });
  });

  it('ends undelivered at the next perform when the server stopped before ending it', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ notification: true });
    const record = outboundCallRecorder(brain.ledger.service);
    await Effect.runPromise(
      record(address, { type: 'delivery_started', number: 1, channel: 'partner', target: 'ada' }, lineage),
    );
    await Effect.runPromise(
      record(
        address,
        { type: 'delivery_ended', number: 1, outcome: 'refused', because: 'status', duration_ms: 3 },
        lineage,
      ),
    );

    await brain.performDue(askedAt);

    expect(receiver.received()).toEqual([]);
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { rejection: { kind: 'undelivered' } } });
  });
});

describe('an expiry due behind attempts', () => {
  it('is read apart from the attempts due before it, as an item that calls out nowhere', async () => {
    const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';
    const { brain, askedAt } = await askedThroughPartner();
    await brain.define('ask-in-inbox', approvalDocument('inbox', 'PT1M'));
    await brain.ask('ask-in-inbox', { campaign: 'Spring', owner: 'ada' }, otherRunId);
    const now = askedAt + 2 * minute;

    const attempts = await Effect.runPromise(brain.due.due(now, 1, true));
    const endings = await Effect.runPromise(brain.due.due(now, 1, false));

    expect([attempts, endings]).toMatchObject([
      [{ key: `acme/alpha/${askedRunId}`, callsOut: true }],
      [{ key: `acme/alpha/${otherRunId}`, callsOut: false }],
    ]);
    expect(await Effect.runPromise(brain.due.nextDueAt(askedAt - minute))).toBeLessThanOrEqual(askedAt);
    expect(await Effect.runPromise(brain.due.nextDueAt(askedAt + 3 * 24 * 60 * minute))).toBeNull();
  });
});

describe('a due request performed out of turn', () => {
  it('does nothing when performed before it is due, and nothing more when its run ended since', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ expires: 'PT1H' });
    const attempt = await brain.dueItems(askedAt);
    const expiry = await brain.dueItems(askedAt + 2 * 60 * minute);
    await brain.call(defineAnswerInteraction(noChannels), { execution_id: askedRunId, answer: { choice: 'approve' } });

    await brain.performAll(attempt, askedAt - minute);
    await brain.performAll(expiry, askedAt + 2 * 60 * minute);

    expect(receiver.received()).toEqual([]);
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('records no end of an attempt that lands after its run was answered, and changes nothing', async () => {
    const receiver = await serveFakeReceiver();
    const meanwhile = { answer: (): Promise<unknown> => Promise.resolve() };
    const fetch = firstDoing(globalThis.fetch, () => meanwhile.answer());
    const brain = interactionHarness({ channels: webhookChannels(receiver.url, { answers: true }), fetch });
    meanwhile.answer = () =>
      brain.call(defineAnswerInteraction(noChannels), { execution_id: askedRunId, answer: { choice: 'reject' } });
    await brain.define('approve-brief', approvalDocument('partner'));
    await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);
    receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    await brain.performDue(Date.now());
    await receiver.close();

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});

describe('a receiver that cannot be reached', () => {
  it('fails the attempt without a status, and the request is tried again on the schedule', async () => {
    const receiver = await serveFakeReceiver();
    await receiver.close();
    const brain = interactionHarness({ channels: webhookChannels(receiver.url) });
    await brain.define('approve-brief', approvalDocument('partner'));
    await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);

    await brain.performDue(Date.now());

    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
  });
});
