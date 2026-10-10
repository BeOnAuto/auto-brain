import { outboundCallRecorder } from '@beonauto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  approvalDocument,
  askedRunId,
  askedThroughChat,
  chatDelivery,
  fakeTools,
  interactionHarness,
} from '../testing/index.ts';

const minute = 60_000;

const address = { org: 'acme', brain: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

const failing = { outcome: 'server_failure', detail: 'The MCP server answered HTTP 503', retryAfterMs: null } as const;

const endsOfADelivery: ReadonlySet<string> = new Set(['delivery_succeeded', 'delivery_failed', 'delivery_refused']);

describe('a notification whose attempts fail', () => {
  it('waits for the next attempt after one that failed, and ends undelivered once the fifth failed', async () => {
    const { brain, tools, askedAt } = await askedThroughChat({ notification: true });
    tools.answerNext(failing, failing, failing, failing, failing);

    await brain.performDue(askedAt);
    const afterTheFirst = await brain.runOf(askedRunId);
    await brain.performEach([1, 2, 3, 4].map((step) => askedAt + step * 20 * minute));

    expect(afterTheFirst).toMatchObject({ output: { status: 'started' } });
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unanswered',
          kind: 'undelivered',
          detail:
            'The notification could not be delivered through the post message tool of chat, though every attempt was made',
        },
      },
    });
  });

  it('ends undelivered at the next perform when the server stopped before ending it', async () => {
    const { brain, tools, askedAt } = await askedThroughChat({ notification: true });
    const record = outboundCallRecorder(brain.ledger.service);
    await Effect.runPromise(
      record(
        address,
        { type: 'delivery_started', data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' } },
        lineage,
      ),
    );
    await Effect.runPromise(
      record(address, { type: 'delivery_refused', data: { number: 1, because: 'too_large', duration_ms: 3 } }, lineage),
    );

    await brain.performDue(askedAt);

    expect(tools.calls()).toEqual([]);
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { rejection: { kind: 'undelivered' } } });
  });
});

describe('an expiry due behind attempts', () => {
  it('is read apart from the attempts due before it, as an item that calls out nowhere', async () => {
    const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';
    const { brain, askedAt } = await askedThroughChat();
    await brain.define('ask-in-inbox', approvalDocument([], 'PT1M'));
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
    const { brain, tools, askedAt } = await askedThroughChat({ expires: 'PT1H' });
    const attempt = await brain.dueItems(askedAt);
    const expiry = await brain.dueItems(askedAt + 2 * 60 * minute);
    await brain.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    await brain.performAll(attempt, askedAt - minute);
    await brain.performAll(expiry, askedAt + 2 * 60 * minute);

    expect(tools.calls()).toEqual([]);
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('records no end of an attempt that lands after its run was answered, and changes nothing', async () => {
    const meanwhile = { answer: (): Promise<unknown> => Promise.resolve() };
    const tools = fakeTools(() => Effect.promise(() => meanwhile.answer()));
    const brain = interactionHarness({ tools });
    meanwhile.answer = () => brain.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'reject' } });
    await brain.define('approve-brief', approvalDocument(chatDelivery));
    await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);

    await brain.performDue(Date.now());
    const { records } = await Effect.runPromise(
      brain.ledger.service.readRecorded(address, { kind: 'run', run: askedRunId }, { order: 'asc', limit: 20 }),
    );

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
    expect(records.map(({ type }) => type).filter((type) => endsOfADelivery.has(type))).toEqual([]);
  });
});
