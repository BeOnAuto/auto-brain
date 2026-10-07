import { describe, expect, it } from 'vitest';

import type { FoldRequest, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { scriptedPool } from './scripted-pool.ts';

const asked: string[] = [];

const otherwise: ProgramPool = {
  workers: 3,
  heapMegabytes: 32,
  run: (request) => {
    asked.push(`run ${request.source}`);
    return Promise.resolve({ ran: 'unfit', work: 0, milliseconds: 1 });
  },
  fold: () => {
    asked.push('fold');
    return Promise.resolve({ ran: 'unreadable', milliseconds: 1 });
  },
  close: () => {
    asked.push('close');
    return Promise.resolve();
  },
};

const request: ProgramRequest = {
  source: '.',
  input: null,
  dialect: { refused: [] },
  limits: { mostWork: 1, mostSteps: 1, mostDepth: 1, mostOutputs: 1, mostValueDepth: 1 },
  deadlineMs: 1,
  mostOutputBytes: 1,
};

const page: FoldRequest = {
  events: [],
  views: [],
  dialect: { refused: [] },
  variable: 'event',
  limits: request.limits,
  foldDeadlineMs: 1,
  pageBudgetMs: 1,
  mostViewBytes: 1,
  waitMs: 1,
  deadlineMs: 1,
};

describe('a scripted pool', () => {
  it('answers runs with the outcomes of its script in turn, then hands them, its folds and its closing to the pool it wraps', async () => {
    const pool = scriptedPool(
      [
        { ran: 'stopped', because: 'busy', milliseconds: 10 },
        { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      ],
      otherwise,
    );

    const ran = [await pool.run(request), await pool.run(request), await pool.run(request)];
    await pool.fold(page);
    await pool.close();

    expect([pool.workers, pool.heapMegabytes]).toEqual([3, 32]);
    expect(ran).toEqual([
      { ran: 'stopped', because: 'busy', milliseconds: 10 },
      { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      { ran: 'unfit', work: 0, milliseconds: 1 },
    ]);
    expect(asked).toEqual(['run .', 'fold', 'close']);
  });
});
