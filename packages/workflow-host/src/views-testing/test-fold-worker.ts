import { parentPort, workerData } from 'node:worker_threads';

import { compileJsonSchema } from '@beonauto/specs/json-schema';
import { foldAnswerOf, mostValueDepth, progressOf, type ViewCheck } from '@beonauto/workflow-engine/worker';
import { Result } from 'effect';

import { sleepBeforeItIsFoldedMs, sleepsBeforeItIsFolded } from './view-documents.ts';

const progress = progressOf(workerData);

const events: unknown = JSON.parse(String(Reflect.get(new Object(workerData), 'events')));

const asleep = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function outputAt(index: number): unknown {
  const event: unknown = Reflect.get(new Object(events), index);
  return Reflect.get(new Object(Reflect.get(new Object(event), 'data')), 'output');
}

function checkOf(schema: unknown): ViewCheck {
  const compiled = compileJsonSchema(schema, { what: 'view', nesting: mostValueDepth });
  return (view) => {
    const checked = Result.flatMap(compiled, ({ validate }) => validate(view));
    return Result.isSuccess(checked) ? undefined : checked.failure.map(({ detail }) => detail).join('; ');
  };
}

function folding(event: number, view: number): void {
  progress.mark(event, view);
  if (outputAt(event) === sleepsBeforeItIsFolded) {
    Atomics.wait(asleep, 0, 0, sleepBeforeItIsFoldedMs);
  }
}

parentPort?.postMessage(
  foldAnswerOf(workerData, { now: () => performance.timeOrigin + performance.now(), folding, checkOf }),
  [],
);
