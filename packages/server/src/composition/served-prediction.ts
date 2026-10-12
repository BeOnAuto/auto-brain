import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { processPool, type ProcessPool } from '@on.auto/workflow-engine/dsl';

import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import type { ServedClosing } from '../lifecycle/lifecycle.ts';
import { logPredictionFunctions } from '../logging/prediction-logging.ts';

export interface ServedPrediction {
  readonly processes: ProcessPool;
  readonly withProcessesClosed: ServedClosing;
}

const mebibyte = 1_048_576;

export async function predictionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { mostFunctions, processes, processMemoryMebibytes, buildsAtOnce, path }: PredictionSettings,
): Promise<ServedPrediction> {
  const memoryBytes = processMemoryMebibytes * mebibyte;
  const pool = processPool({ processes, longJobs: buildsAtOnce, memoryBytes, path });
  await runtime.run(
    logPredictionFunctions({
      mostFunctions,
      processes,
      memoryMebibytes: processMemoryMebibytes,
      buildsAtOnce,
      limiter: pool.limiter,
    }),
  );
  return {
    processes: pool,
    withProcessesClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await pool.close();
      },
    }),
  };
}
