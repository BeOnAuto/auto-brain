import { parentPort, workerData } from 'node:worker_threads';

import { answerOf } from '@beonauto/workflow-engine/worker';

import { outputCheckOf } from './value-checks.ts';

const context: unknown = Reflect.get(new Object(workerData), 'context');

parentPort?.postMessage(
  answerOf(workerData, () => performance.timeOrigin + performance.now(), outputCheckOf(context)),
  [],
);
