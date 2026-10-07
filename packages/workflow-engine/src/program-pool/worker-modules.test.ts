import { parentPort } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import * as foldWorker from './fold-worker.ts';
import * as programWorker from './program-worker.ts';

describe('the worker modules of the pool, loaded on a thread that has no parent port', () => {
  it('serve nothing there and export nothing, so loading one on the main thread neither fails nor listens to a port', () => {
    expect([parentPort, Object.keys(programWorker), Object.keys(foldWorker)]).toEqual([null, [], []]);
  });
});
