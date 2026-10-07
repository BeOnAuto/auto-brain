import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughPartner } from '../testing/index.ts';

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
