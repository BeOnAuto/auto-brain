import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConversationLedger } from '../conversations/conversation-parts.ts';
import { conversationsDue } from '../conversations/conversations-due.ts';
import { answerInteraction } from '../requests/answer-interaction.ts';
import { dueInBothLanes } from '../testing/harness-parts.ts';
import { answererId, chatHarness, farAhead, recordsOf, type ChatHarness } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function answeredMeanwhile(brain: ChatHarness): ConversationLedger {
  const ledger = brain.ledger.service;
  return {
    ...ledger,
    readProjectedRows: (name, place, query) =>
      Effect.tap(ledger.readProjectedRows(name, place, query), () =>
        Effect.promise(() => brain.call(answerInteraction, { run_id: runId, answer: { choice: 'reject' } })),
      ),
  };
}

function cancelledMeanwhile(brain: ChatHarness): ConversationLedger {
  const ledger = brain.ledger.service;
  return {
    ...ledger,
    readProjectedRows: (name, place, query) =>
      Effect.tap(ledger.readProjectedRows(name, place, query), () => Effect.promise(() => brain.cancel(runId))),
  };
}

async function repliedInThread(text = 'approve'): Promise<ChatHarness> {
  const brain = await chatHarness();
  await brain.askInThread(runId);
  await brain.performDue(Date.now());
  const [thread] = brain.chat.posted().map(({ ts }) => ts);
  brain.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text });
  return brain;
}

function readOver(brain: ChatHarness, ledger: ConversationLedger) {
  const reads = conversationsDue({ ledger, tools: brain.chat, record: brain.record });
  const now = Date.now() + farAhead;
  return Effect.runPromise(
    Effect.exit(
      Effect.flatMap(
        Effect.promise(() => dueInBothLanes(reads, now)),
        (items) => Effect.forEach(items, (item) => item.perform(now)),
      ),
    ),
  );
}

describe('a reply taken', () => {
  it('leaves the list of open requests at once, and the due work settles the run from the answer it brought', async () => {
    const brain = await repliedInThread();

    const exit = await readOver(brain, brain.ledger.service);
    const afterReading = [await brain.firstOpen(), await brain.runOf(runId)];
    await brain.performDue(Date.now());

    expect([Exit.isSuccess(exit), ...afterReading]).toMatchObject([true, undefined, { output: { status: 'started' } }]);
    expect(await brain.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: {} },
    });
    expect(await recordsOf(brain.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' }, reply: { sender: answererId } } },
    ]);
  });
});

describe('a reply to a request answered while the conversation was read', () => {
  it('takes nothing, and the answer given first is the one the run takes', async () => {
    const brain = await repliedInThread();

    await readOver(brain, answeredMeanwhile(brain));
    await brain.performDue(Date.now());

    expect(
      (await recordsOf(brain.ledger, 'request_answered', 'reply_refused')).map(({ type, data }) => [type, data]),
    ).toEqual([['request_answered', { answer: { choice: 'reject' } }]]);
    expect(await brain.runOf(runId)).toMatchObject({ output: { output: { choice: 'reject' } } });
  });
});

describe('a reply refused once a cancel of the run was asked while the conversation was read', () => {
  it('records nothing and tells nobody', async () => {
    const brain = await repliedInThread('maybe later');

    const exit = await readOver(brain, cancelledMeanwhile(brain));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await recordsOf(brain.ledger, 'run_cancel_requested', 'reply_refused', 'telling_started')).toMatchObject([
      { type: 'run_cancel_requested' },
    ]);
    expect(brain.chat.posted()).toHaveLength(1);
  });
});
