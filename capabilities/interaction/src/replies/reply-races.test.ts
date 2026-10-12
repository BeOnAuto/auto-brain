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

function answeredMeanwhile(playbook: ChatHarness): ConversationLedger {
  const ledger = playbook.ledger.service;
  return {
    ...ledger,
    readProjectedRows: (name, place, query) =>
      Effect.tap(ledger.readProjectedRows(name, place, query), () =>
        Effect.promise(() => playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'reject' } })),
      ),
  };
}

async function repliedInThread(): Promise<ChatHarness> {
  const playbook = await chatHarness();
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [thread] = playbook.chat.posted().map(({ ts }) => ts);
  playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text: 'approve' });
  return playbook;
}

function readOver(playbook: ChatHarness, ledger: ConversationLedger) {
  const reads = conversationsDue({ ledger, tools: playbook.chat });
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
    const playbook = await repliedInThread();

    const exit = await readOver(playbook, stoppingBeforeSettling(playbook.ledger.service));
    const afterStop = await playbook.firstOpen();
    await playbook.performDue(Date.now());

    expect([Exit.isFailure(exit), afterStop]).toMatchObject([true, { standing: 'answered' }]);
    expect(await playbook.runOf(runId)).toMatchObject({
      output: {
        status: 'succeeded',
        output: { choice: 'approve' },
        record: { answered_by: 'playbook:alpha', reply: { sender: answererId } },
      },
    });
  });
});

describe('a reply to a request answered while the conversation was read', () => {
  it('takes nothing, and the answer given first stands', async () => {
    const playbook = await repliedInThread();

    await readOver(playbook, answeredMeanwhile(playbook));

    expect(await recordsOf(playbook.ledger, 'reply_taken', 'reply_refused')).toEqual([]);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { output: { choice: 'reject' } } });
  });
});
