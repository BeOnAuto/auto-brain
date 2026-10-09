import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AnsweredOnce } from '../delivery/delivery-bounds.ts';
import { conversationCallStreamOf, type ConversationCallEvent } from './conversation-call-events.ts';
import { conversationCallDecider, repliesReadOf, tellingEndedOf, tellingStartedOf } from './conversation-calls.ts';

const recorded = { by: 'brain:alpha', at: '2026-10-08T09:00:05.000Z' };

const reference = { server: 'chat', tool: 'thread_replies' };

const started = { ...reference, arguments_bytes: 40, arguments_sha256: 'a'.repeat(64) };

const answered: AnsweredOnce = {
  kind: 'answered',
  outcome: 'result',
  answer: { content: [] },
  fields: { result_bytes: 61, result_sha256: 'b'.repeat(64), jsonrpc_id: 2 },
  durationMs: 7,
  detail: '',
  retryAfterMs: null,
};

const notOffered = { kind: 'not_offered', because: 'tool_not_allowed', detail: 'Not allowed' } as const;

const reading = {
  callId: 'call-1',
  start: started,
  end: answered,
  outcome: 'result' as const,
  conversation: 'C0123/1699.1',
  since: '1699.3',
  replies: 2,
  taken: 1,
  refused: 1,
  retryAfterMs: null,
};

function decided(event: ConversationCallEvent, ...history: readonly ConversationCallEvent[]) {
  const state = history.reduce(
    (kept, each) => conversationCallDecider.evolve(kept, each),
    conversationCallDecider.initialState,
  );
  return conversationCallDecider.decide(event, state);
}

describe('a telling the brain makes in a conversation', () => {
  it('records its start with the call it sends and its end with what the tool answered', () => {
    expect(tellingStartedOf({ callId: 'call-2', runId: 'run-1' }, started, recorded)).toEqual({
      type: 'telling_started',
      call_id: 'call-2',
      run_id: 'run-1',
      ...started,
      ...recorded,
    });
    expect(tellingEndedOf('call-2', answered, recorded)).toEqual({
      type: 'telling_ended',
      call_id: 'call-2',
      outcome: 'result',
      ...answered.fields,
      duration_ms: 7,
      ...recorded,
    });
  });

  it('records no answer when the server no longer offers the tool, or its connection could not be opened', () => {
    expect([
      tellingEndedOf('call-3', notOffered, recorded),
      tellingEndedOf('call-4', { kind: 'unopened', because: 'mcp_server_failed', detail: 'Unreachable' }, recorded),
    ]).toEqual([
      { type: 'telling_ended', call_id: 'call-3', outcome: 'tool_not_offered', ...recorded },
      { type: 'telling_ended', call_id: 'call-4', outcome: 'server_failure', ...recorded },
    ]);
  });
});

describe('a read the brain makes in a conversation', () => {
  it('is one fact, with the call and what the read found, and the wait a 429 asked for', () => {
    expect(repliesReadOf({ ...reading, retryAfterMs: 60_000 }, recorded)).toEqual({
      type: 'replies_read',
      call_id: 'call-1',
      ...started,
      ...answered.fields,
      duration_ms: 7,
      outcome: 'result',
      conversation: 'C0123/1699.1',
      since: '1699.3',
      replies: 2,
      taken: 1,
      refused: 1,
      retry_after_ms: 60_000,
      ...recorded,
    });
  });

  it('carries no answer when the server no longer offers the tool', () => {
    expect(repliesReadOf({ ...reading, end: notOffered, outcome: 'tool_not_offered', replies: 0 }, recorded)).toEqual({
      type: 'replies_read',
      call_id: 'call-1',
      ...started,
      outcome: 'tool_not_offered',
      conversation: 'C0123/1699.1',
      since: '1699.3',
      replies: 0,
      taken: 1,
      refused: 1,
      ...recorded,
    });
  });
});

describe('a read the brain could not send', () => {
  it('names the tool alone, with no answer and the reason in its detail', () => {
    const { arguments_bytes: _bytes, arguments_sha256: _digest, ...tool } = started;

    expect(
      repliesReadOf(
        {
          callId: 'call-5',
          start: tool,
          outcome: 'not_sent',
          detail: 'The arguments of the read take 18015 bytes, more than the 16384 a call may send',
          conversation: 'C0123/1699.1',
          since: null,
          replies: 0,
          taken: 0,
          refused: 0,
          retryAfterMs: null,
        },
        recorded,
      ),
    ).toEqual({
      type: 'replies_read',
      call_id: 'call-5',
      server: 'chat',
      tool: 'thread_replies',
      outcome: 'not_sent',
      detail: 'The arguments of the read take 18015 bytes, more than the 16384 a call may send',
      conversation: 'C0123/1699.1',
      since: null,
      replies: 0,
      taken: 0,
      refused: 0,
      ...recorded,
    });
  });
});

describe('the turns of a call in a conversation', () => {
  const telling = tellingStartedOf({ callId: 'call-2', runId: 'run-1' }, started, recorded);
  const ending = tellingEndedOf('call-2', answered, recorded);
  const read = repliesReadOf(reading, recorded);

  it('take the start of a telling and then its end, or a read, once each', () => {
    expect([decided(telling), decided(ending, telling), decided(read)]).toEqual([
      Result.succeed([telling]),
      Result.succeed([ending]),
      Result.succeed([read]),
    ]);
  });

  it('refuse anything out of turn', () => {
    expect([
      decided(ending),
      decided(read, read),
      decided(telling, telling),
      decided(ending, telling, ending),
    ]).toMatchObject([Result.fail({}), Result.fail({}), Result.fail({}), Result.fail({})]);
    expect(conversationCallStreamOf('call-1')).toBe('conversation-calls/call-1');
  });
});
