import { describe, expect, it } from 'vitest';

import type { CheckRequest, FoldRequest, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { scriptedPool } from './scripted-pool.ts';

const asked: string[] = [];

const otherwise: ProgramPool = {
  workers: 3,
  heapMegabytes: 32,
  run: (request) => {
    asked.push(`run ${request.source}`);
    return Promise.resolve({ ran: 'oversized', work: 0, milliseconds: 1 });
  },
  fold: () => {
    asked.push('fold');
    return Promise.resolve({ ran: 'unreadable', milliseconds: 1 });
  },
  check: () => {
    asked.push('check');
    return Promise.resolve({ ran: 'checked', issues: [], milliseconds: 1 });
  },
  close: () => {
    asked.push('close');
    return Promise.resolve();
  },
};

const request: ProgramRequest = {
  source: '.',
  entry: 'default',
  arguments: [null],
  moment: 0,
  budget: 1,
  memoryBytes: 1,
  stackBytes: 1,
  deadlineMs: 1,
  mostOutputBytes: 1,
};

const checked: CheckRequest = { schemas: {}, expressions: [], deadlineMs: 1, worker: new URL('data:text/javascript,') };

const page: FoldRequest = {
  events: [],
  views: [],
  budget: 1,
  memoryBytes: 1,
  stackBytes: 1,
  foldDeadlineMs: 1,
  pageBudgetMs: 1,
  mostViewBytes: 1,
  waitMs: 1,
  deadlineMs: 1,
};

describe('a scripted pool', () => {
  it('answers runs with the outcomes of its script in turn, then hands them, its folds, its checks and its closing to the pool it wraps', async () => {
    const pool = scriptedPool(
      [
        { ran: 'stopped', because: 'busy', milliseconds: 10 },
        { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      ],
      otherwise,
    );

    const ran = [await pool.run(request), await pool.run(request), await pool.run(request)];
    await pool.fold(page);
    await pool.check(checked);
    await pool.close();

    expect([pool.workers, pool.heapMegabytes]).toEqual([3, 32]);
    expect(ran).toEqual([
      { ran: 'stopped', because: 'busy', milliseconds: 10 },
      { ran: 'crashed', detail: 'broken', milliseconds: 2 },
      { ran: 'oversized', work: 0, milliseconds: 1 },
    ]);
    expect(asked).toEqual(['run .', 'fold', 'check', 'close']);
  });
});
