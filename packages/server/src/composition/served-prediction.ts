import type { AppRuntime } from '@beonauto/api';
import type { DispatcherServices } from '@beonauto/operations';
import { processPool, type ProcessPool } from '@beonauto/workflow-engine/dsl';

import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import type { Served } from '../lifecycle/lifecycle.ts';
import { logModelProcesses } from '../logging/model-process-logging.ts';

export type ServedClosing = (served: Served) => Served;

export interface ServedPrediction {
  readonly processes: ProcessPool;
  readonly withProcessesClosed: ServedClosing;
}

const mebibyte = 1_048_576;

export async function predictionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { processes, processMemoryMebibytes, buildsAtOnce }: PredictionSettings,
): Promise<ServedPrediction> {
  const pool = processPool({ processes, longJobs: buildsAtOnce, memoryBytes: processMemoryMebibytes * mebibyte });
  await runtime.run(
    logModelProcesses({ processes, memoryMebibytes: processMemoryMebibytes, buildsAtOnce, limiter: pool.limiter }),
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
