import { outboundCallRecorder } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { askedRunId, askedThroughChat, noTools } from '../testing/index.ts';
import { requestsDue } from './due-requests.ts';

const minute = 60_000;

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

describe('an attempt the server stopped in', () => {
  it('ends as lost once its bound passed, and the next attempt follows on the schedule', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    await Effect.runPromise(
      outboundCallRecorder(brain.ledger.service)(
        address,
        { type: 'delivery_started', number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
        { causationId: null, correlationId: askedRunId },
      ),
    );

    const whileInFlight = await brain.performDue(askedAt + 30_000);
    await brain.performDue(Date.now() + minute + 1000);
    const lost = await brain.firstOpen();
    await brain.performDue(Date.now() + 2 * minute + 2000);

    expect(whileInFlight).toBe(0);
    expect(lost).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(tools.calls()).toHaveLength(1);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });
});

describe('an attempt two hosts make at once', () => {
  it('is made by the host whose start is recorded first, and the other sends nothing', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    const items = await brain.dueItems(askedAt);

    await brain.performAll([...items, ...items], askedAt);

    expect(tools.calls()).toHaveLength(1);
  });
});

describe('a due request whose run has ended, or whose tool is no longer allowed', () => {
  it('sends nothing for a run answered since it was read as due', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    const items = await brain.dueItems(askedAt);
    await brain.call(answerInteraction, { execution_id: askedRunId, answer: { choice: 'approve' } });

    await brain.performAll(items, askedAt);

    expect(tools.calls()).toEqual([]);
  });

  it('fails each attempt as a tool no longer offered, and the request stays open, to be answered through the inbox', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.disallow('post_message');

    await brain.performDue(askedAt);
    const open = await brain.firstOpen();
    const nextDue = await Effect.runPromise(brain.due.nextDueAt(askedAt));
    const answered = await brain.call(answerInteraction, { execution_id: askedRunId, answer: { choice: 'approve' } });

    expect(tools.calls()).toEqual([]);
    expect(open).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(nextDue).toBeGreaterThan(askedAt + minute - 1000);
    expect(answered).toMatchObject({ status: 'succeeded', output: { output: { choice: 'approve' } } });
  });
});

describe('a request whose tool server is gone since it asked', () => {
  it('fails its attempt as a tool no longer offered, and two hosts that try record the failure once', async () => {
    const { brain, askedAt } = await askedThroughChat();
    const withoutServers = requestsDue({ ledger: brain.ledger.service, tools: noTools });
    const items = await brain.dueItems(askedAt, withoutServers);

    await brain.performAll([...items, ...items], askedAt);

    expect(await brain.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
  });
});

describe('a request whose run is asked to cancel', () => {
  it('sends nothing more, even for an attempt read as due before the cancel was asked', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    const items = await brain.dueItems(askedAt);

    const asked = await brain.cancel(askedRunId);
    await brain.performAll(items, askedAt);
    const performed = await brain.performDue(Date.now() + 10 * minute);

    expect([asked.status, performed, tools.calls()]).toEqual(['succeeded', 0, []]);
    expect(await brain.firstOpen()).toMatchObject({ standing: 'cancelling', attempts: 0 });
  });
});
