import type { RecordedEvent } from '@beonauto/operations';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { followedEventOf } from './followed-events.ts';

const at = '2026-10-01T09:00:00.000Z';

const told = { specversion: '1.0', id: 'e1', source: '/acme', type: 'com.acme.told', time: at };

type Data = Readonly<Record<string, Schema.Json>> & { readonly type: string };

function recordOf(stream: string, data: Data, correlationId: string | null = null): RecordedEvent {
  return {
    id: `id-${stream}`,
    cursor: 'c',
    causationId: null,
    correlationId,
    stream,
    version: 1,
    type: data.type,
    data,
    recordedAt: at,
  };
}

function published(extra: Readonly<Record<string, Schema.Json>>, correlationId: string | null = null) {
  const data = { type: 'event_published', event: told, filled: [], ...extra, by: 'acme-admin', at };
  return followedEventOf(recordOf('events/e1', data, correlationId), 'orchestration');
}

function runFact(executionId: string, [primitive, name]: readonly [string, string], correlationId: string | null) {
  const data = {
    type: 'execution_started',
    primitive,
    name,
    spec_version: 1,
    input: {},
    by: 'acme-admin',
    at,
  };
  return followedEventOf(recordOf(`executions/${executionId}`, data, correlationId), 'orchestration');
}

const emittedBy = { emitted_by: { execution_id: 'r-nested', workflow: 'close', version: 1 }, depth: 2 };

describe('an event published to a brain, as the follower reads it', () => {
  it('is the event at depth 1 when sent from outside, owned by no workflow', () => {
    expect(published({})).toEqual({ event: told, depth: 1, emitter: undefined, ownedBy: [], topRun: undefined });
  });

  it('when a run emitted it, is owned by the workflow of that run, and names the run that began the chain', () => {
    expect([published(emittedBy, 'r-top'), published(emittedBy, 'r-nested'), published(emittedBy)]).toMatchObject([
      { depth: 2, emitter: { executionId: 'r-nested', workflow: 'close' }, ownedBy: ['close'], topRun: 'r-top' },
      { topRun: undefined },
      { topRun: undefined },
    ]);
  });

  it('is unreadable when its record cannot be read as a publication', () => {
    expect(followedEventOf(recordOf('events/e1', { type: 'event_published' }), 'orchestration')).toBe('unreadable');
  });
});

describe('a fact of a brain, as the follower reads it', () => {
  it('about a run, is owned by the workflow it ran and names the run that began the chain, one deeper', () => {
    expect([
      runFact('r-1', ['orchestration', 'close'], 'r-top'),
      runFact('r-2', ['inference', 'sum'], 'r-2'),
    ]).toMatchObject([
      {
        depth: 1,
        ownedBy: ['close'],
        topRun: 'r-top',
        event: { type: 'execution_started', subject: 'orchestration/close' },
      },
      { depth: 1, ownedBy: [], topRun: undefined, event: { subject: 'inference/sum' } },
    ]);
  });

  it('about a spec, is owned by no workflow', () => {
    const retired = { type: 'spec_retired', name: 'close', by: 'acme-admin', at };

    expect(followedEventOf(recordOf('specs/orchestration', retired), 'orchestration')).toMatchObject({
      depth: 1,
      ownedBy: [],
      topRun: undefined,
      event: { type: 'spec_retired', source: '/specs/orchestration/close' },
    });
  });

  it('is unreadable when its record cannot be read, and no fact at all for a record that is none', () => {
    expect([
      followedEventOf(recordOf('executions/r-1', { type: 'execution_started' }), 'orchestration'),
      followedEventOf(recordOf('executions/r-1', { type: 'call_recorded' }), 'orchestration'),
      followedEventOf(recordOf('runs/r-1', { type: 'input_applied' }), 'orchestration'),
    ]).toEqual(['unreadable', 'none', 'none']);
  });

  it('is none for the records of a test of a tool, which no recall function folds and no trigger takes, with no note', () => {
    const tested = { test_id: 't-1', server: 'graph', tool: 'search', by: 'acme-builder', at };

    expect([
      followedEventOf(recordOf('tool-tests/t-1', { type: 'tool_test_started', ...tested }), 'orchestration'),
      followedEventOf(recordOf('tool-tests/t-1', { type: 'tool_test_answered', ...tested }), 'orchestration'),
      followedEventOf(recordOf('tool-tests/t-1', { type: 'tool_test_started' }), 'recollection'),
    ]).toEqual(['none', 'none', 'none']);
  });
});

describe('the reads and tellings of a conversation, as the follower meets them', () => {
  it('are none, which no recall function folds and no trigger takes', () => {
    const read = { call_id: 'c-1', server: 'chat', tool: 'thread_replies', by: 'brain:alpha', at };

    expect([
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'replies_read', ...read }), 'orchestration'),
      followedEventOf(recordOf('conversation-calls/c-1', { type: 'telling_started', ...read }), 'recollection'),
    ]).toEqual(['none', 'none']);
  });
});
