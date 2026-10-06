import { parentPort, workerData } from 'node:worker_threads';

import { foldAnswerOf, progressOf } from '@beonauto/workflow-engine/worker';

import { viewCheckOf } from './value-checks.ts';

const progress = progressOf(workerData);

parentPort?.postMessage(
  foldAnswerOf(workerData, {
    now: () => performance.timeOrigin + performance.now(),
    folding: (event, view) => {
      progress.mark(event, view);
    },
    checkOf: viewCheckOf,
  }),
  [],
);
