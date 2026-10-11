import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  type FakeAnswer,
} from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const aSize: unknown = expect.any(Number);

function textOf(text: string): FakeAnswer {
  return { outcome: 'result', answer: { content: [{ type: 'text', text }] }, detail: '', retryAfterMs: null };
}

async function deliveredInThread(document?: string) {
  const brain = await chatHarness(document === undefined ? {} : { document });
  await brain.askInThread(runId);
  await brain.performDue(Date.now());
  return brain;
}

async function readAfter(answer: FakeAnswer) {
  const brain = await deliveredInThread();
  brain.chat.answerNext(answer);
  const before = Date.now();
  await brain.performReads(before + farAhead);
  const [read] = await recordsOf(brain.ledger, 'reading_failed');
  const [row] = await conversationRows(brain.ledger);
  return { brain, read, row: row?.row, before };
}

async function failedRead(answer: FakeAnswer): Promise<readonly unknown[]> {
  const { read, row } = await readAfter(answer);
  return [read?.data, row?.['open']];
}

describe('a read that fails', () => {
  it('is recorded with what went wrong, and the cadence goes on', async () => {
    const answers: readonly FakeAnswer[] = [
      answered({ messages: [], padding: 'x'.repeat(70_000) }),
      textOf('Nothing new.'),
      answered({ messages: { ts: '1' } }),
      { outcome: 'result', answer: { content: [{ type: 'image' }] }, detail: '', retryAfterMs: null },
      { outcome: 'tool_error', detail: 'channel_not_found', retryAfterMs: null },
      { outcome: 'timed_out', detail: 'The MCP server did not answer within 30000 ms', retryAfterMs: null },
      { outcome: 'cancelled', detail: '', retryAfterMs: null },
      { kind: 'unopened', detail: 'The MCP server could not be reached' },
      { kind: 'not_offered' },
    ];

    expect(await Promise.all(answers.map((answer) => failedRead(answer)))).toMatchObject([
      [{ because: 'too_large', result_bytes: aSize }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'unreadable' }, true],
      [{ because: 'tool_error' }, true],
      [{ because: 'timed_out' }, true],
      [{ because: 'cancelled' }, true],
      [{ because: 'server_failure' }, true],
      [{ because: 'tool_not_offered', server: 'chat', tool: 'thread_replies' }, true],
    ]);
  });

  it('waits as long as a server asked with Retry-After, an hour at most', async () => {
    const { read, row, before } = await readAfter({
      outcome: 'server_failure',
      detail: 'The MCP server answered HTTP 429',
      retryAfterMs: 120_000,
    });

    expect(read?.data).toMatchObject({ because: 'server_failure', retry_after_ms: 120_000 });
    expect(Number(row?.['next_read_at'])).toBeGreaterThanOrEqual(before + 120_000);
  });
});

describe('a conversation whose reading tool its operator disallowed', () => {
  it('records a failed read, tool_not_offered, and the cadence goes on with the request open', async () => {
    const brain = await deliveredInThread();
    brain.chat.disallow('thread_replies');

    await brain.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(brain.ledger);

    expect(await recordsOf(brain.ledger, 'reading_failed')).toMatchObject([{ data: { because: 'tool_not_offered' } }]);
    expect(row?.row).toMatchObject({ open: true, reads: 1 });
    expect(await brain.firstOpen()).toMatchObject({ standing: 'delivered' });
  });
});

describe('a conversation with nothing open in it', () => {
  it('rests, with no call, once its one request was answered through answer_interaction', async () => {
    const brain = await deliveredInThread();
    await brain.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } });

    await brain.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(brain.ledger);

    expect([row?.row['open'], row?.row['due_at'], brain.chat.calls()]).toMatchObject([false, null, [{}]]);
  });
});

describe('a listed reply without an identity or a sender that fits', () => {
  it('is passed over, and the cursor moves to the newest identity that fits', async () => {
    const listed = [
      { user: answererId, text: 'approve' },
      { ts: '9.1', text: 'approve' },
      { ts: 'x'.repeat(300), user: answererId, text: 'approve' },
      { ts: '9.2', user: 'U'.repeat(300), text: 'approve' },
    ];
    const brain = await deliveredInThread();
    brain.chat.answerNext(answered({ messages: listed }));
    await brain.performReads(Date.now() + farAhead);
    const [read] = await recordsOf(brain.ledger, 'replies_read');

    expect(read?.data).toMatchObject({ replies: 4, taken: 0, refused: 0, since: '9.2' });
    expect(await brain.firstOpen()).toMatchObject({ standing: 'delivered' });
  });
});
