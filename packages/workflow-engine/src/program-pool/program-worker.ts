import { parentPort, workerData } from 'node:worker_threads';

import { answerOf } from './program-answer.ts';

parentPort?.postMessage(
  answerOf(workerData, () => performance.timeOrigin + performance.now()),
  [],
);
