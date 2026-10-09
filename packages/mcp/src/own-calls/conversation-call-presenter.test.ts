import { describe, expect, it } from 'vitest';

import type { ConversationCallEvent } from './conversation-call-events.ts';
import { conversationCallPresenter } from './conversation-call-presenter.ts';

const recorded = { by: 'brain:alpha', at: '2026-10-08T09:00:05.000Z' };

const reading = {
  type: 'replies_read',
  call_id: 'call-1',
  server: 'chat',
  tool: 'thread_replies',
  arguments_bytes: 61,
  arguments_sha256: 'a'.repeat(64),
  conversation: 'C0123/1699.1',
  since: null,
  replies: 0,
  taken: 0,
  refused: 0,
  ...recorded,
} as const;

const answered = {
  result_bytes: 120,
  result_sha256: 'b'.repeat(64),
  duration_ms: 7,
  jsonrpc_id: 'rpc-2',
  server_request_id: 'req-9',
};

function shown(data: ConversationCallEvent) {
  const [event] = conversationCallPresenter.present({
    id: 'event-1',
    cursor: 'cursor-1',
    causationId: 'cause-1',
    correlationId: null,
    stream: 'acme/alpha/brain/conversation-calls/call-1',
    version: 1,
    type: data.type,
    data,
    recordedAt: recorded.at,
  });
  return event;
}

describe('a read the brain made in a conversation, as the brain events show it', () => {
  it('says what it found through which tool, with the call and its content as the server records it', () => {
    expect(
      shown({
        ...reading,
        ...answered,
        outcome: 'result',
        since: '1699.3',
        replies: 2,
        taken: 1,
        refused: 1,
        arguments_json: '{"ts":"1699.1"}',
        result_json: '{"messages":[]}',
      }),
    ).toEqual({
      id: 'event-1',
      cursor: 'cursor-1',
      causation_id: 'cause-1',
      at: recorded.at,
      type: 'replies_read',
      summary:
        'The brain looked for new replies in the conversation “C0123/1699.1” through the tool thread_replies of chat and found 2, took 1 as an answer and refused 1.',
      data: {
        call_id: 'call-1',
        by: 'brain:alpha',
        server: 'chat',
        tool: 'thread_replies',
        arguments_bytes: 61,
        arguments_sha256: 'a'.repeat(64),
        arguments_json: '{"ts":"1699.1"}',
        conversation: 'C0123/1699.1',
        since: '1699.3',
        outcome: 'result',
        replies: 2,
        taken: 1,
        refused: 1,
        ...answered,
        result_json: '{"messages":[]}',
      },
    });
  });
});

describe('a read the brain could not make in a conversation, as the brain events show it', () => {
  it('says why, with no answer where no call was answered and the wait a server asked for', () => {
    const notOffered = shown({ ...reading, outcome: 'tool_not_offered' });
    const { arguments_bytes: _bytes, arguments_sha256: _digest, ...unsent } = reading;
    const notSent = shown({ ...unsent, outcome: 'not_sent', detail: 'The argument ts of the read cannot be rendered' });
    const timedOut = shown({
      ...reading,
      outcome: 'timed_out',
      result_bytes: null,
      result_sha256: null,
      duration_ms: 30_000,
      jsonrpc_id: 4,
      server_request_id: null,
      retry_after_ms: 60_000,
    });

    expect([notOffered?.summary, timedOut?.summary]).toEqual([
      'The brain could not read the replies of the conversation “C0123/1699.1” through the tool thread_replies of chat: the tool server no longer offers the tool to this brain.',
      'The brain could not read the replies of the conversation “C0123/1699.1” through the tool thread_replies of chat: the tool server did not answer within 30 seconds.',
    ]);
    expect(notOffered?.data).not.toHaveProperty('duration_ms');
    expect(notSent).toMatchObject({
      summary:
        'The brain could not read the replies of the conversation “C0123/1699.1” through the tool thread_replies of chat: its arguments could not be rendered, so nothing was sent.',
      data: { detail: 'The argument ts of the read cannot be rendered' },
    });
    expect(notSent?.data).not.toHaveProperty('arguments_bytes');
    expect(timedOut?.data).toMatchObject({
      result_bytes: null,
      result_sha256: null,
      jsonrpc_id: 4,
      server_request_id: null,
      retry_after_ms: 60_000,
    });
  });
});

describe('a telling the brain made in a conversation, as the brain events show it', () => {
  it('says through which tool it told the party how to answer, and what the tool did', () => {
    const started = shown({
      type: 'telling_started',
      call_id: 'call-2',
      run_id: 'run-1',
      server: 'chat',
      tool: 'post_message',
      arguments_bytes: 80,
      arguments_sha256: 'c'.repeat(64),
      ...recorded,
    });
    const ended = shown({ type: 'telling_ended', call_id: 'call-2', outcome: 'result', ...answered, ...recorded });
    const refused = shown({ type: 'telling_ended', call_id: 'call-3', outcome: 'tool_not_offered', ...recorded });

    expect([started?.summary, ended?.summary, refused?.summary]).toEqual([
      'The brain told the party how to answer through the tool post_message of chat.',
      'The tool that told the party answered.',
      'The tool that told the party was no longer offered by its server.',
    ]);
    expect([started?.data, ended?.data]).toMatchObject([
      { call_id: 'call-2', run_id: 'run-1', arguments_bytes: 80 },
      { outcome: 'result', ...answered },
    ]);
  });
});
