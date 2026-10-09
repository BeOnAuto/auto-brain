import type { ProjectedRow } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { conversations } from './conversation-rows.ts';

const stream = { kind: 'runs', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const ofTheBrain = { definition_type: 'interaction', name: 'approve-brief', definition_version: 1, by: 'brain:alpha' };

const deliveredAs = { conversation: 'C0123', id: '1699.1' };

const repliesIn = { server: 'chat', tool: 'thread_replies', key: 'C0123/1699.1' };

function deliveryEnded(at: string, keeping = true) {
  const delivered = { type: 'delivery_ended', number: 1, outcome: 'delivered', duration_ms: 5, ...ofTheBrain, at };
  return keeping ? { ...delivered, delivered_as: deliveredAs, replies_in: repliesIn } : delivered;
}

function read(since: string | null, type = 'replies_read') {
  return {
    type,
    call_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70',
    server: 'chat',
    tool: 'thread_replies',
    arguments_bytes: 34,
    arguments_sha256: 'a'.repeat(64),
    outcome: 'result',
    result_bytes: 120,
    result_sha256: 'b'.repeat(64),
    duration_ms: 12,
    jsonrpc_id: 2,
    conversation: 'C0123/1699.1',
    since,
    replies: 1,
    taken: 0,
    refused: 0,
    by: 'brain:alpha',
    at: '2026-10-01T09:00:10.000Z',
  };
}

const joinedAt = Date.parse('2026-10-01T09:00:00.000Z');

function rowAfter(row: ProjectedRow | undefined, event: unknown, id = 'fact-1'): ProjectedRow | undefined {
  return conversations.rowAfter(row, event, { id, position: 1 });
}

describe('the conversations projection', () => {
  it('keys a delivery that kept where replies are read, and a read, by the server, the tool and the conversation', () => {
    const events: readonly unknown[] = [deliveryEnded('2026-10-01T09:00:00.000Z'), read(null)];

    expect(events.map((event) => conversations.keyOf?.(event, stream))).toEqual([
      'chat/thread_replies/C0123/1699.1',
      'chat/thread_replies/C0123/1699.1',
    ]);
  });

  it('keys nothing for a delivery that kept no place to read, nor for a telling', () => {
    const events: readonly unknown[] = [
      deliveryEnded('2026-10-01T09:00:00.000Z', false),
      read(null, 'telling_started'),
    ];

    expect(events.map((event) => [conversations.keyOf?.(event, stream), rowAfter(undefined, event)])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it('opens a row when a request joins it, due five seconds after', () => {
    expect(rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z'))).toEqual({
      server: 'chat',
      tool: 'thread_replies',
      conversation: 'C0123/1699.1',
      since: null,
      last_fact: 'fact-1',
      joined_by: 'fact-1',
      open: true,
      active_at: joinedAt,
      reads: 0,
      next_read_at: joinedAt + 5000,
      due_at: joinedAt + 5000,
    });
  });
});

describe('a row of the conversations projection', () => {
  it('keeps the cursor of a read and leaves its cadence to the reader', () => {
    const joined = rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z'));

    expect(rowAfter({ ...joined, reads: 3 }, read('1699.4'), 'fact-2')).toMatchObject({
      since: '1699.4',
      last_fact: 'fact-2',
      joined_by: 'fact-1',
      reads: 3,
    });
  });

  it('starts the cadence again when another request joins, keeping the cursor and the sooner read', () => {
    const resting = { ...rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z')), since: '1699.4', reads: 40 };

    expect(rowAfter(resting, deliveryEnded('2026-10-01T10:00:00.000Z'), 'fact-3')).toMatchObject({
      since: '1699.4',
      last_fact: 'fact-3',
      joined_by: 'fact-3',
      open: true,
      reads: 0,
      active_at: joinedAt + 3_600_000,
      next_read_at: joinedAt + 5000,
    });
  });

  it('writes no row for a read of a conversation it never opened', () => {
    expect(rowAfter(undefined, read('1699.4'))).toBeUndefined();
  });
});
