import { describe, expect, it } from 'vitest';

import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const third = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73';

async function deliveredInThread(brain: ChatHarness, ...runIds: readonly string[]): Promise<readonly string[]> {
  await Promise.all(runIds.map((runId) => brain.askInThread(runId)));
  await brain.performDue(Date.now());
  return brain.chat.posted().map(({ ts }) => ts);
}

function readsOf(brain: ChatHarness): number {
  return brain.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies').length;
}

describe('the replies of a conversation, read once for every open request in it', () => {
  it('takes a reply from the answerer as the answer, settled by the brain with the reply as evidence', async () => {
    const brain = await chatHarness();
    const [thread] = await deliveredInThread(brain, first);
    brain.chat.reply({
      channel: '#approvals-sales',
      thread,
      user: answererId,
      text: 'Reject, the second point is wrong',
    });

    await brain.performReads(Date.now() + farAhead);

    expect(await brain.runOf(first)).toMatchObject({
      output: {
        status: 'succeeded',
        output: { choice: 'reject', note: 'the second point is wrong' },
        record: { answered_by: 'brain:alpha', reply: { id: '1699.000002', sender: answererId } },
      },
    });
    expect(JSON.stringify(await brain.runOf(first))).not.toContain('claimed_for');
    expect(await recordsOf(brain.ledger, 'reply_taken', 'replies_read')).toMatchObject([
      { type: 'reply_taken', data: { server: 'chat', tool: 'thread_replies' } },
      { type: 'replies_read', data: { conversation: '#approvals-sales/1699.000001', taken: 1, since: '1699.000002' } },
    ]);
  });

  it('reads one conversation once for three requests in it, and each thread on its own', async () => {
    const flat = await chatHarness({ document: threadDocument({ replies: flatReplies }) });
    await deliveredInThread(flat, first, second, third);
    const threads = await chatHarness();
    await deliveredInThread(threads, first, second, third);

    await flat.performReads(Date.now() + farAhead);
    await threads.performReads(Date.now() + farAhead);

    expect([readsOf(flat), readsOf(threads)]).toEqual([1, 3]);
    expect((await conversationRows(flat.ledger)).map(({ key }) => key)).toEqual([
      'chat/thread_replies/#approvals-sales',
    ]);
  });
});

describe('a read of replies that finds nothing to take', () => {
  it('writes no fact for a read that found nothing, and waits longer before the next', async () => {
    const brain = await chatHarness();
    await deliveredInThread(brain, first);
    brain.chat.answerNext(answered({ messages: [] }));

    await brain.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(brain.ledger);

    expect(await recordsOf(brain.ledger, 'replies_read')).toEqual([]);
    expect(row?.row).toMatchObject({ open: true, reads: 1, since: null });
  });

  it('passes over a reply from anyone but the answerer, and records it nowhere', async () => {
    const brain = await chatHarness();
    const [thread] = await deliveredInThread(brain, first);
    brain.chat.reply({ channel: '#approvals-sales', thread, user: 'U0STRANGER', text: 'approve' });

    await brain.performReads(Date.now() + farAhead);

    expect(await recordsOf(brain.ledger, 'reply_taken', 'reply_refused')).toEqual([]);
    expect(await recordsOf(brain.ledger, 'replies_read')).toMatchObject([
      { data: { replies: 2, taken: 0, refused: 0 } },
    ]);
    expect(await brain.firstOpen()).toMatchObject({ standing: 'delivered' });
  });
});
