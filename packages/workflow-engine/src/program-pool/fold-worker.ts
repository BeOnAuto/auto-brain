import { parentPort, workerData } from 'node:worker_threads';

import { foldAnswerOf } from './fold-answer.ts';
import { progressOf } from './fold-progress.ts';

const progress = progressOf(workerData);

parentPort?.postMessage(
  foldAnswerOf(workerData, {
    now: () => performance.timeOrigin + performance.now(),
    folding: (event, view) => {
      progress.mark(event, view);
    },
  }),
  [],
);
