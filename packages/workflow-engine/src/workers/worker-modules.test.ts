import { describe, expect, it } from 'vitest';

import * as foldWorker from './fold-worker.ts';
import * as programWorker from './program-worker.ts';

describe('the worker modules of the pool, loaded where there is no parent port, as on the thread of a test', () => {
  it('serve nothing there and export nothing, so loading one neither fails nor listens to a port', () => {
    expect([Object.keys(programWorker), Object.keys(foldWorker)]).toEqual([[], []]);
  });
});
