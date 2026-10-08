import { executionEventOf } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  alpha,
  answered,
  approvalDocument,
  chatDelivery,
  chatHarness,
  notificationDocument,
  type ChatHarness,
  type FakeAnswer,
} from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const takesNoReply = ', so the request takes no reply and waits for answer_interaction';

async function deliveryEndOf(brain: ChatHarness) {
  const { records } = await Effect.runPromise(
    brain.ledger.service.readRecorded(alpha, { kind: 'run', execution: runId }, { order: 'asc', limit: 20 }),
  );
  return records.map(({ data }) => executionEventOf(data)).find((event) => event?.type === 'delivery_ended');
}

async function deliveredWith(answer?: FakeAnswer, document?: string) {
  const brain = await chatHarness(document === undefined ? {} : { document });
  if (answer !== undefined) {
    brain.chat.answerNext(answer);
  }
  await brain.askInThread(runId);
  await brain.performDue(Date.now());
  return { brain, ended: await deliveryEndOf(brain) };
}

function keptOf(ended: Awaited<ReturnType<typeof deliveryEndOf>>) {
  return ended?.type === 'delivery_ended' ? [ended.delivered_as, ended.replies_in, ended.detail] : ['no delivery'];
}

function textAnswer(text: string): FakeAnswer {
  return { outcome: 'result', answer: { content: [{ type: 'text', text }] }, detail: '', retryAfterMs: null };
}

describe('a delivery whose function reads replies', () => {
  it('keeps the conversation and the message its tool sent, from the text of its answer, and where replies are read', async () => {
    const { brain, ended } = await deliveredWith();

    expect(ended).toMatchObject({
      outcome: 'delivered',
      delivered_as: { conversation: '#approvals-sales', id: '1699.000001' },
      replies_in: { server: 'chat', tool: 'thread_replies', key: '#approvals-sales/1699.000001' },
    });
    expect(await brain.firstOpen()).toMatchObject({
      standing: 'delivered',
      conversation: '#approvals-sales/1699.000001',
      answerer: 'U024BE7LH',
      reply_refusals: 0,
    });
  });

  it('reads the structured content of the answer before its text', async () => {
    const { ended } = await deliveredWith({
      outcome: 'result',
      answer: {
        content: [{ type: 'text', text: 'Posted.' }],
        structuredContent: { channel: 'C0123', ts: 1_699_000_001 },
      },
      detail: '',
      retryAfterMs: null,
    });

    expect(ended).toMatchObject({
      delivered_as: { conversation: 'C0123', id: '1699000001' },
      replies_in: { key: 'C0123/1699000001' },
    });
  });
});

describe('a delivery whose answer names no message the brain can keep', () => {
  it('is delivered with the reason in its detail and no conversation, so the request waits for answer_interaction', async () => {
    const answers: readonly FakeAnswer[] = [
      { outcome: 'result', answer: { content: [{ type: 'image' }] }, detail: '', retryAfterMs: null },
      textAnswer('Posted.'),
      answered({ ok: true, channel: 'C0123' }),
      answered({ channel: 'C0123', ts: 'x'.repeat(300) }),
      answered({ channel: `C${'1'.repeat(200)}`, ts: '1'.repeat(200) }),
    ];
    const ends = await Promise.all(answers.map(async (answer) => (await deliveredWith(answer)).ended));

    expect(ends.map((ended) => keptOf(ended))).toEqual([
      [
        undefined,
        undefined,
        `The answer of the tool holds no JSON document, in its structured content or its first text${takesNoReply}`,
      ],
      [
        undefined,
        undefined,
        `The answer of the tool holds no JSON document, in its structured content or its first text${takesNoReply}`,
      ],
      [undefined, undefined, `The answer of the tool has no text or whole number at /ts, its message${takesNoReply}`],
      [
        undefined,
        undefined,
        `The message at /ts takes more than 256 bytes or holds a character a part may not hold${takesNoReply}`,
      ],
      [
        undefined,
        undefined,
        `The conversation's key renders to nothing, to more than 256 bytes or to a character a key may not hold${takesNoReply}`,
      ],
    ]);
  });
});

describe('a delivery whose request takes no reply', () => {
  it('keeps what the message was delivered as, and no place to read replies, for a notification or a function without replies', async () => {
    const documents = [notificationDocument(chatDelivery), approvalDocument(chatDelivery)];

    const ends = await Promise.all(documents.map(async (document) => (await deliveredWith(undefined, document)).ended));

    expect(ends.map((ended) => keptOf(ended))).toEqual([
      [{ conversation: '#approvals-U024BE7LH', id: '1699.000001' }, undefined, undefined],
      [{ conversation: '#approvals-U024BE7LH', id: '1699.000001' }, undefined, undefined],
    ]);
  });

  it('keeps nothing and says nothing for a delivery without sent pointers that answers with no document', async () => {
    const { ended } = await deliveredWith(textAnswer('Posted.'), approvalDocument(chatDelivery.slice(0, 6)));

    expect(keptOf(ended)).toEqual([undefined, undefined, undefined]);
  });
});
