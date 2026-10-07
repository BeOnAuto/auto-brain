import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughPartner, type AskedRequest } from '../testing/index.ts';

const decodeAt = Schema.decodeUnknownSync(Schema.Struct({ at: Schema.String }));

describe('a receiver that answers within the delivery', () => {
  it('settles the run with an answer that fits the schema, recorded as the channel’s', async () => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ answers: true });
    receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
  });

  it.each([
    ['not JSON', { status: 200, body: 'approved' }],
    ['an answer the schema refuses', { status: 200, body: JSON.stringify({ choice: 'maybe' }) }],
    ['not even an object', { status: 200, body: JSON.stringify('approve') }],
    ['more than 64 KiB', { status: 200, body: JSON.stringify({ choice: 'approve', note: 'x'.repeat(70_000) }) }],
  ] as const)('fails the attempt for a body that is %s, and the request waits for the next', async (_case, answer) => {
    const { brain, receiver, askedAt } = await askedThroughPartner({ answers: true });
    receiver.answerWith(answer);

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
  });

  it('is only a delivery when the status is not 200, or the channel does not take answers', async () => {
    const accepted = await askedThroughPartner({ answers: true });
    accepted.receiver.answerWith({ status: 202, body: JSON.stringify({ choice: 'approve' }) });
    const ignored = await askedThroughPartner();
    ignored.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    await accepted.brain.performDue(accepted.askedAt);
    await ignored.brain.performDue(ignored.askedAt);

    expect([await accepted.brain.firstOpen(), await ignored.brain.firstOpen()]).toMatchObject([
      { standing: 'delivered' },
      { standing: 'delivered' },
    ]);
  });
});

async function endedAt({ brain }: AskedRequest): Promise<unknown> {
  const { records } = await Effect.runPromise(
    brain.ledger.service.readRecorded(
      { org: 'acme', brain: 'alpha' },
      { kind: 'run', execution: askedRunId },
      { order: 'desc', limit: 1, types: ['delivery_ended'] },
    ),
  );
  return decodeAt(records[0]?.data).at;
}

describe('the time an answer or a delivery is recorded at', () => {
  it('is the time its delivery ended, as a settlement made again after a stop records it', async () => {
    const answered = await askedThroughPartner({ answers: true });
    answered.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });
    const notified = await askedThroughPartner({ notification: true });

    await answered.brain.performDue(answered.askedAt);
    await notified.brain.performDue(notified.askedAt);

    expect(await answered.brain.runOf(askedRunId)).toMatchObject({
      output: { record: { answered_at: await endedAt(answered) } },
    });
    expect(await notified.brain.runOf(askedRunId)).toMatchObject({
      output: { record: { delivered_at: await endedAt(notified) } },
    });
  });
});
