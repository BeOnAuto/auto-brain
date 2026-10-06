import { parentPort, workerData } from 'node:worker_threads';

import { compileJsonSchema } from '@beonauto/specs/json-schema';
import { foldAnswerOf, mostValueDepth, progressOf, type ViewCheck } from '@beonauto/workflow-engine/worker';
import { Result } from 'effect';

const progress = progressOf(workerData);

function checkOf(schema: unknown): ViewCheck {
  const compiled = compileJsonSchema(schema, { what: 'view', nesting: mostValueDepth });
  return (view) => {
    const checked = Result.flatMap(compiled, ({ validate }) => validate(view));
    return Result.isSuccess(checked) ? undefined : checked.failure.map(({ detail }) => detail).join('; ');
  };
}

parentPort?.postMessage(
  foldAnswerOf(workerData, {
    now: () => performance.timeOrigin + performance.now(),
    folding: (event, view) => {
      progress.mark(event, view);
    },
    checkOf,
  }),
  [],
);
