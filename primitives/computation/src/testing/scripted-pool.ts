import type { PoolOutcome, ProgramPool } from '@beonauto/workflow-engine/dsl';

export function scriptedPool(script: readonly PoolOutcome[], otherwise: ProgramPool): ProgramPool {
  const remaining = [...script];
  return {
    workers: otherwise.workers,
    heapMegabytes: otherwise.heapMegabytes,
    run: (request, signal) => {
      const [next] = remaining.splice(0, 1);
      return next === undefined ? otherwise.run(request, signal) : Promise.resolve(next);
    },
    close: otherwise.close,
  };
}
