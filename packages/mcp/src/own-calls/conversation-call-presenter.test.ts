import type { KeptContent } from '@beonauto/operations';
import { nothingKept } from '@beonauto/operations/testing';
import { describe, expect, it } from 'vitest';

import type { ConversationCallEvent } from './conversation-call-events.ts';
import { conversationCallPresenter } from './conversation-call-presenter.ts';

const at = '2026-10-08T09:00:05.000Z';

const thePlace = {
  call_id: 'call-1',
  server: 'chat',
  tool: 'thread_replies',
  conversation: 'C0123/1699.1',
  since: null,
  arguments_bytes: 61,
  arguments_sha256: 'a'.repeat(64),
};

const answered = {
  result_bytes: 120,
  result_sha256: 'b'.repeat(64),
  content_kept: true,
  duration_ms: 7,
  jsonrpc_id: 'rpc-2',
  server_request_id: 'req-9',
};

const kept: Readonly<Record<string, string>> = {
  ['a'.repeat(64)]: '{"ts":"1699.1"}',
  ['b'.repeat(64)]: '{"content":[{"type":"text","text":"{\\"messages\\":[]}"}]}',
};

const keptContent: KeptContent = (sha256) => kept[sha256];

function shown(event: ConversationCallEvent, content: KeptContent = keptContent) {
  const [fact] = conversationCallPresenter.present(
    {
      id: 'event-1',
      cursor: 'cursor-1',
      causationId: 'cause-1',
      correlationId: null,
      stream: 'conversation-calls/call-1',
      version: 1,
      globalPosition: 9,
      type: event.type,
      data: event.data,
      context: { at, by: 'brain:alpha' },
      recordedAt: at,
    },
    content,
  );
  return fact;
}

describe('a read the brain made in a conversation, as the brain events show it', () => {
  it('says what it found through which tool, with the arguments and the answer it kept', () => {
    expect(
      shown({
        type: 'replies_read',
        data: { ...thePlace, ...answered, since: '1699.3', replies: 2, taken: 1, refused: 1 },
      }),
    ).toEqual({
      type: 'replies_read',
      summary:
        'The brain looked for new replies in the conversation “C0123/1699.1” through the thread replies tool of chat and found 2, took 1 as an answer and refused 1.',
      data: {
        ...thePlace,
        ...answered,
        since: '1699.3',
        replies: 2,
        taken: 1,
        refused: 1,
        arguments: { ts: '1699.1' },
        result: { content: [{ type: 'text', text: '{"messages":[]}' }] },
        answer: { messages: [] },
      },
    });
  });

  it('shows no content the read did not keep, even when another read kept the same', () => {
    const read = shown(
      {
        type: 'replies_read',
        data: { ...thePlace, ...answered, content_kept: false, replies: 0, taken: 0, refused: 0 },
      },
      keptContent,
    );

    expect(read?.data).not.toHaveProperty('arguments');
    expect(read?.data).not.toHaveProperty('answer');
  });
});

describe('a read the brain could not make in a conversation, as the brain events show it', () => {
  it('says why, with no answer where no call was answered and the wait a server asked for', () => {
    const notOffered = shown(
      { type: 'reading_failed', data: { ...thePlace, because: 'tool_not_offered' } },
      nothingKept,
    );
    const { arguments_bytes: _bytes, arguments_sha256: _digest, ...unsent } = thePlace;
    const notSent = shown({
      type: 'reading_failed',
      data: { ...unsent, because: 'not_sent', detail: 'The argument ts of the read cannot be rendered' },
    });
    const timedOut = shown({
      type: 'reading_failed',
      data: { ...thePlace, because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 4, retry_after_ms: 60_000 },
    });
    const refused = shown({ type: 'reading_failed', data: { ...thePlace, because: 'arguments_refused' } });

    expect([notOffered?.summary, timedOut?.summary, refused?.summary]).toEqual([
      'The brain could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server no longer offers the tool to this brain.',
      'The brain could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server did not answer within 30 seconds.',
      'The brain could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server refused the arguments of the read.',
    ]);
    expect(notOffered?.data).toEqual({ ...thePlace, because: 'tool_not_offered' });
    expect(notSent).toMatchObject({
      summary:
        'The brain could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: its arguments could not be rendered, so nothing was sent.',
      data: { detail: 'The argument ts of the read cannot be rendered' },
    });
    expect(notSent?.data).not.toHaveProperty('arguments_bytes');
    expect(timedOut?.data).toMatchObject({ because: 'timed_out', jsonrpc_id: 4, retry_after_ms: 60_000 });
  });
});

describe('a telling the brain made in a conversation, as the brain events show it', () => {
  it('says through which tool it told the party how to answer, and what the tool did', () => {
    const started = shown({
      type: 'telling_started',
      data: {
        call_id: 'call-2',
        server: 'chat',
        tool: 'post_message',
        arguments_bytes: 80,
        arguments_sha256: 'c'.repeat(64),
        content_kept: true,
      },
    });
    const succeeded = shown({ type: 'telling_succeeded', data: { call_id: 'call-2', ...answered } });
    const failed = shown({
      type: 'telling_failed',
      data: { call_id: 'call-3', because: 'tool_error', detail: 'No channel', ...answered },
    });
    const notOffered = shown({ type: 'telling_failed', data: { call_id: 'call-4', because: 'tool_not_offered' } });

    expect([started?.summary, succeeded?.summary, failed?.summary, notOffered?.summary]).toEqual([
      'The brain told the party how to answer through the post message tool of chat.',
      'The tool that told the party answered.',
      'The tool that told the party answered with an error of its own.',
      'The tool that told the party was no longer offered by its server.',
    ]);
    expect([started?.data, succeeded?.data, failed?.data]).toMatchObject([
      { call_id: 'call-2', arguments_bytes: 80, content_kept: true },
      { ...answered, answer: { messages: [] } },
      { because: 'tool_error', detail: 'No channel', answer: { messages: [] } },
    ]);
  });
});
