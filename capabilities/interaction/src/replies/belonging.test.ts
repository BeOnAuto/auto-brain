import { describe, expect, it } from 'vitest';

import {
  answered,
  answererId,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const flat = { document: threadDocument({ replies: flatReplies }) };

async function delivered(brain: ChatHarness, ...runIds: readonly string[]): Promise<readonly string[]> {
  await Promise.all(runIds.map((runId) => brain.askInThread(runId)));
  await brain.performDue(Date.now());
  return brain.chat.posted().map(({ ts }) => ts);
}

describe('a reply in a conversation with several open requests', () => {
  it('answers the request whose message its thread began with, and none other', async () => {
    const brain = await chatHarness();
    const [, secondThread] = await delivered(brain, first, second);
    brain.chat.reply({ channel, thread: secondThread, user: answererId, text: 'approve' });

    await brain.performReads(Date.now() + farAhead);

    expect([await brain.runOf(first), await brain.runOf(second)]).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });

  it('is refused as ambiguous on the newest when it names no message, and the party told to reply to one', async () => {
    const brain = await chatHarness(flat);
    await delivered(brain, first, second);
    brain.chat.reply({ channel, user: answererId, text: 'approve' });

    await brain.performReads(Date.now() + farAhead);

    expect(await recordsOf(brain.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'ambiguous', told: true } },
    ]);
    expect(brain.chat.posted().at(-1)?.text).toBe(
      'Several questions are open here; reply to the message of the one you answer.',
    );
  });

  it('answers the one open request of a conversation when it names no message', async () => {
    const brain = await chatHarness(flat);
    await delivered(brain, first);
    brain.chat.reply({ channel, user: answererId, text: 'yes' });

    await brain.performReads(Date.now() + farAhead);

    expect(await brain.runOf(first)).toMatchObject({ output: { status: 'succeeded', output: { choice: 'approve' } } });
  });
});

function readAgain(brain: ChatHarness, thread: string, ts: string, text: string) {
  brain.chat.answerNext(answered({ messages: [{ ts, user: answererId, text, thread_ts: thread }] }));
}

describe('a reply the brain has already met', () => {
  it('takes the first answer of a read, and a second reply with other words takes nothing', async () => {
    const brain = await chatHarness();
    const [thread] = await delivered(brain, first);
    brain.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    brain.chat.reply({ channel, thread, user: answererId, text: 'reject' });

    await brain.performReads(Date.now() + farAhead);

    expect((await recordsOf(brain.ledger, 'reply_taken', 'reply_refused')).map(({ type }) => type)).toEqual([
      'reply_taken',
    ]);
    expect(await brain.runOf(first)).toMatchObject({ output: { output: { choice: 'approve' } } });
  });

  it('refuses a reply read twice once, and tells the party once', async () => {
    const brain = await chatHarness();
    const [thread = ''] = await delivered(brain, first);
    const maybe = brain.chat.reply({ channel, thread, user: answererId, text: 'maybe' });
    await brain.performReads(Date.now() + farAhead);
    readAgain(brain, thread, maybe, 'maybe');

    await brain.performReads(Date.now() + 2 * farAhead);

    expect(await recordsOf(brain.ledger, 'reply_refused')).toHaveLength(1);
    expect(brain.chat.posted()).toHaveLength(2);
    expect(brain.chat.calls().map(({ reference }) => reference.tool)).toEqual([
      'post_message',
      'thread_replies',
      'post_message',
      'thread_replies',
    ]);
  });

  it('takes nothing for a request whose run is being cancelled', async () => {
    const brain = await chatHarness();
    const [thread] = await delivered(brain, first);
    await brain.cancel(first);
    brain.chat.reply({ channel, thread, user: answererId, text: 'approve' });

    await brain.performReads(Date.now() + farAhead);

    expect(await recordsOf(brain.ledger, 'reply_taken', 'reply_refused')).toEqual([]);
    expect(await brain.firstOpen()).toMatchObject({ standing: 'cancelling' });
    expect(brain.chat.calls().map(({ reference }) => reference.tool)).toEqual(['post_message']);
  });
});
