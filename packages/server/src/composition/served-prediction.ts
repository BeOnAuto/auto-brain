import type { AppRuntime } from '@on.auto/api';
import { openRequestsName } from '@on.auto/interaction';
import type { DispatcherServices } from '@on.auto/operations';
import { modelPorts, type PredictionPorts } from '@on.auto/prediction';
import { processPool } from '@on.auto/workflow-engine/dsl';
import type { WorkflowStore } from '@on.auto/workflow-host';

import type { ServedClosing } from '../lifecycle/lifecycle.ts';
import { logPredictionFunctions } from '../logging/prediction-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ServedPrediction {
  readonly ports: PredictionPorts;
  readonly withProcessesClosed: ServedClosing;
}

const mebibyte = 1_048_576;

export async function predictionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { prediction, interaction }: Pick<Settings, 'prediction' | 'interaction'>,
  store: WorkflowStore,
): Promise<ServedPrediction> {
  const { mostFunctions, processes, processMemoryMebibytes, buildsAtOnce, buildsPerDay, path } = prediction;
  const memoryBytes = processMemoryMebibytes * mebibyte;
  const pool = processPool({ processes, longJobs: buildsAtOnce, memoryBytes, path });
  await runtime.run(
    logPredictionFunctions({
      mostFunctions,
      processes,
      memoryMebibytes: processMemoryMebibytes,
      buildsAtOnce,
      buildsPerDay,
      limiter: pool.limiter,
    }),
  );
  const ledger = runtimeLedger(runtime);
  return {
    ports: {
      ledger,
      database: store.database,
      ...modelPorts({ pool, scoringAtOnce: buildsAtOnce }),
      bounds: { buildsPerDay, buildsAtOnce, mostOpenRequests: interaction.mostOpenRequests },
      openRequests: (playbook) =>
        ledger.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
    },
    withProcessesClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await pool.close();
      },
    }),
  };
}
