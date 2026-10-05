import { describe, expect, it } from 'vitest';

import { echo } from '../testing/echo.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { listExecutions, getExecutionHistory } = specOperationsFor([echo]);

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function run(status: string): Readonly<Record<string, unknown>> {
  return {
    execution_id: executionId,
    primitive: 'echo',
    name: 'greet',
    spec_version: 1,
    status,
    started_at: '2026-10-01T09:00:00.000Z',
    started_by: 'acme-admin',
  };
}

function listed(executions: readonly unknown[], filters: object = {}, hasMore = false): string | undefined {
  return listExecutions.registration.plainLanguage?.outcome(
    { executions, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null },
    filters,
  );
}

const event = {
  id: 'WyJicmFpbiJd',
  at: '2026-10-01T09:00:00.000Z',
  type: 'execution_started',
  summary: 'A run started.',
  data: {},
};

function found(events: readonly unknown[], input: object = {}, hasMore = false): string | undefined {
  return getExecutionHistory.registration.plainLanguage?.outcome(
    { events, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null },
    { execution_id: executionId, ...input },
  );
}

describe('the plain language of list_executions', () => {
  it('says how many runs it listed and how they ended', () => {
    expect([
      listed([run('started'), run('succeeded'), run('rejected')]),
      listed([run('failed'), run('failed')], { status: 'failed' }, true),
      listed([run('succeeded')], { name: 'greet' }),
      listed(
        Array.from({ length: 100 }, () => run('succeeded')),
        {},
        true,
      ),
    ]).toEqual([
      'Listed 3 runs, newest first: 1 still running, 1 finished, and 1 did not go through.',
      'Listed 2 runs that broke down, newest first. More remain after these.',
      'Listed 1 run of anything named “greet”, newest first: 1 finished.',
      'Listed one hundred runs, newest first: one hundred finished. More remain after these.',
    ]);
  });

  it('says there are none, none more, or none on this page with more to look through', () => {
    expect([
      listed([]),
      listed([], { primitive: 'echo' }),
      listed([], { cursor: 'WyJicmFpbiJd', status: 'started' }),
      listed([], { primitive: 'echo', name: 'greet', status: 'succeeded' }, true),
    ]).toEqual([
      'This brain has no runs yet.',
      'This brain has no runs of greetings.',
      'There are no more runs that are still running.',
      'This page holds no runs of the greeting “greet” that finished, but there are more runs to look through.',
    ]);
  });

  it('names the runs it tried to list', () => {
    expect([
      listExecutions.registration.plainLanguage?.attempt({}),
      listExecutions.registration.plainLanguage?.attempt({ primitive: 'echo', status: 'started' }),
      listExecutions.registration.plainLanguage?.attempt({ status: 'sideways' }),
    ]).toEqual(['list the runs', 'list the runs of greetings that are still running', 'list the runs']);
  });
});

describe('the plain language of get_execution_history', () => {
  it('says how many events of the run it found, in which order', () => {
    expect([found([event, event]), found([event], { order: 'desc' }, true)]).toEqual([
      'Found 2 events in the history of the run, oldest first.',
      'Found 1 event in the history of the run, newest first. More remain after these.',
    ]);
  });

  it('says when a page shows nothing', () => {
    expect([found([], {}, true), found([]), found([], { cursor: 'WyJicmFpbiJd' })]).toEqual([
      'This page shows nothing of the run, but there is more of its history to read.',
      'The run has nothing to show yet.',
      'There is nothing more to show of the run.',
    ]);
  });

  it('names what it tried', () => {
    expect([
      getExecutionHistory.registration.plainLanguage?.attempt({ execution_id: executionId }),
      getExecutionHistory.registration.plainLanguage?.attempt({}),
    ]).toEqual(['read the history of the run', 'read the history of a run']);
  });
});
