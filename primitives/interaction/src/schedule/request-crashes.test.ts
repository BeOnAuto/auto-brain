import { Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughPartner, type AskedRequest } from '../testing/index.ts';
import type { RequestLedger } from './request-ledger.ts';

const days = 24 * 60 * 60_000;

const anyTime: unknown = expect.any(String);

const isOutboundCall = Schema.is(Schema.Struct({ type: Schema.Literal('outbound_call') }));

function stoppingBeforeSettling(ledger: RequestLedger): RequestLedger {
  return {
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      isOutboundCall(command)
        ? ledger.execute(stream, decider, command, lineage)
        : Effect.die(new Error('The server stopped before it settled the run')),
  };
}

async function attemptedThenStopped({ brain, askedAt }: AskedRequest): Promise<boolean> {
  const stopping = brain.dueOver(stoppingBeforeSettling(brain.ledger.service));
  const items = await Effect.runPromise(stopping.due(askedAt, 256));
  const exit = await Effect.runPromise(Effect.exit(Effect.forEach(items, (item) => item.perform(askedAt))));
  return Exit.isFailure(exit);
}

describe('an answer given within the delivery, whose settlement the server stopped before', () => {
  it('is settled from the ended delivery after a restart, with no attempt made again', async () => {
    const asked = await askedThroughPartner({ answers: true });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'approve' }) });

    const stopped = await attemptedThenStopped(asked);
    const afterStop = await asked.brain.firstOpen();
    const performed = await asked.brain.performDue(Date.now());

    expect([stopped, performed]).toEqual([true, 1]);
    expect(afterStop).toMatchObject({ attempts: 1, standing: 'answered' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { choice: 'approve' }, record: { answered_by: 'channel:partner' } },
    });
    expect(asked.receiver.received()).toHaveLength(1);
  });

  it('is settled with the answer even when the restart comes after the request would have expired', async () => {
    const asked = await askedThroughPartner({ answers: true });
    asked.receiver.answerWith({ status: 200, body: JSON.stringify({ choice: 'reject' }) });

    await attemptedThenStopped(asked);
    await asked.brain.performDue(asked.askedAt + 3 * days);

    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});

describe('a notification delivered, whose settlement the server stopped before', () => {
  it('succeeds from the ended delivery after a restart, and is not delivered again', async () => {
    const asked = await askedThroughPartner({ notification: true });

    await attemptedThenStopped(asked);
    const afterStop = await asked.brain.firstOpen();
    await asked.brain.performDue(Date.now());

    expect(afterStop).toMatchObject({ attempts: 1, standing: 'delivered' });
    expect(await asked.brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
    expect(asked.receiver.received()).toHaveLength(1);
  });
});

describe('a due request, as the host sees it', () => {
  it('calls out for an attempt, and not for an expiry, a settlement or an attempt lost', async () => {
    const { brain, askedAt } = await askedThroughPartner();

    const toAttempt = await brain.dueItems(askedAt);
    const toExpire = await brain.dueItems(askedAt + 3 * days);

    expect([toAttempt.map(({ callsOut }) => callsOut), toExpire.map(({ callsOut }) => callsOut)]).toEqual([
      [true],
      [false],
    ]);
  });
});
