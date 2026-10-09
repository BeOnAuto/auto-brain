import { Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConversationLedger } from '../conversations/conversation-parts.ts';
import { conversationsDue } from '../conversations/conversations-due.ts';
import { answerInteraction } from '../requests/answer-interaction.ts';
import { dueInBothLanes } from '../testing/harness-parts.ts';
import { answererId, chatHarness, farAhead, recordsOf, type ChatHarness } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const isSettlement = Schema.is(Schema.Struct({ type: Schema.Literal('settle') }));

function stoppingBeforeSettling(ledger: ConversationLedger): ConversationLedger {
  return {
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      isSettlement(command)
        ? Effect.die(new Error('The server stopped before it settled the run'))
        : ledger.execute(stream, decider, command, lineage),
  };
}

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

async function repliedInThread(): Promise<ChatHarness> {
  const brain = await chatHarness();
  await brain.askInThread(runId);
  await brain.performDue(Date.now());
  const [thread] = brain.chat.posted().map(({ ts }) => ts);
  brain.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text: 'approve' });
  return brain;
}

function readOver(brain: ChatHarness, ledger: ConversationLedger) {
  const reads = conversationsDue({ ledger, tools: brain.chat });
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

describe('a reply taken, whose settlement the server stopped before', () => {
  it('is settled from the reply after a restart, with the reply as evidence', async () => {
    const brain = await repliedInThread();

    const exit = await readOver(brain, stoppingBeforeSettling(brain.ledger.service));
    const afterStop = await brain.firstOpen();
    await brain.performDue(Date.now());

    expect([Exit.isFailure(exit), afterStop]).toMatchObject([true, { standing: 'answered' }]);
    expect(await brain.runOf(runId)).toMatchObject({
      output: {
        status: 'succeeded',
        output: { choice: 'approve' },
        record: { answered_by: 'brain:alpha', reply: { sender: answererId } },
      },
    });
  });
});

describe('a reply to a request answered while the conversation was read', () => {
  it('takes nothing, and the answer given first stands', async () => {
    const brain = await repliedInThread();

    await readOver(brain, answeredMeanwhile(brain));

    expect(await recordsOf(brain.ledger, 'reply_taken', 'reply_refused')).toEqual([]);
    expect(await brain.runOf(runId)).toMatchObject({ output: { output: { choice: 'reject' } } });
  });
});
