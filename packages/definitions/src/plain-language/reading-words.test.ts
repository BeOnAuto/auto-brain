import { describe, expect, it } from 'vitest';

import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { echo } from '../testing/echo.ts';

const { listRuns, getRunHistory } = definitionOperationsFor([echo]);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function run(status: string): Readonly<Record<string, unknown>> {
  return {
    run_id: runId,
    type: 'echo',
    name: 'greet',
    definition_version: 1,
    status,
    started_at: '2026-10-01T09:00:00.000Z',
    started_by: 'acme-admin',
  };
}

function listed(runs: readonly unknown[], filters: object = {}, hasMore = false): string | undefined {
  return listRuns.registration.plainLanguage?.outcome(
    { runs, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null },
    filters,
  );
}

const event = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  cursor: 'WyJicmFpbiJd',
  causation_id: null,
  at: '2026-10-01T09:00:00.000Z',
  type: 'run_started',
  summary: 'A run started.',
  data: {},
};

function found(events: readonly unknown[], input: object = {}, hasMore = false): string | undefined {
  return getRunHistory.registration.plainLanguage?.outcome(
    { events, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null },
    { run_id: runId, ...input },
  );
}

describe('the plain language of list_runs', () => {
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
      listed([], { type: 'echo' }),
      listed([], { cursor: 'WyJicmFpbiJd', status: 'started' }),
      listed([], { type: 'echo', name: 'greet', status: 'succeeded' }, true),
    ]).toEqual([
      'This brain has no runs yet.',
      'This brain has no runs of greetings.',
      'There are no more runs that are still running.',
      'This page holds no runs of the greeting “greet” that finished, but there are more runs to look through.',
    ]);
  });

  it('names the runs it tried to list', () => {
    expect([
      listRuns.registration.plainLanguage?.attempt({}),
      listRuns.registration.plainLanguage?.attempt({ type: 'echo', status: 'started' }),
      listRuns.registration.plainLanguage?.attempt({ status: 'sideways' }),
    ]).toEqual(['list the runs', 'list the runs of greetings that are still running', 'list the runs']);
  });
});

describe('the plain language of get_run_history', () => {
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
      getRunHistory.registration.plainLanguage?.attempt({ run_id: runId }),
      getRunHistory.registration.plainLanguage?.attempt({}),
    ]).toEqual(['read the history of the run', 'read the history of a run']);
  });
});
