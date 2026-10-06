import { parentPort, workerData } from 'node:worker_threads';

import { foldAnswerOf } from '../folds/fold-answer.ts';
import { progressOf } from '../folds/fold-progress.ts';

const progress = progressOf(workerData);

const noSchemaChecked = 'This worker checks no view schema; a page whose views keep one names a worker that does';

parentPort?.postMessage(
  foldAnswerOf(workerData, {
    now: () => performance.timeOrigin + performance.now(),
    folding: (event, view) => {
      progress.mark(event, view);
    },
    checkOf: () => () => noSchemaChecked,
  }),
  [],
);
