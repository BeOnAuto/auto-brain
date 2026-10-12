import type { AppRuntime } from '@beonauto/api';
import type { Capability } from '@beonauto/definitions';
import type { DispatcherServices, HttpRegistration } from '@beonauto/operations';
import { datasetFolder, datasetsPortOn, makePredictionFunctionAdapter, uploadDataset } from '@beonauto/prediction';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { someFolder, type SomeFolder, type WorkflowStore } from '@beonauto/workflow-host';

import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';
import { predictionServedBy, type ServedPrediction } from './served-prediction.ts';

interface PlaybookRoute {
  readonly registration: HttpRegistration<'playbook'>;
}

export interface ServedPredictionFunctions extends ServedPrediction {
  readonly capability: Capability;
  readonly routes: readonly PlaybookRoute[];
}

export function datasetsFolderOf(pool: ProgramPool): SomeFolder {
  return someFolder(datasetFolder({ filters: pool.evaluations.filters }));
}

export async function predictionFunctionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: PredictionSettings,
  pool: ProgramPool,
  store: WorkflowStore,
): Promise<ServedPredictionFunctions> {
  const { processes, withProcessesClosed } = await predictionServedBy(runtime, settings);
  return {
    processes,
    withProcessesClosed,
    capability: makePredictionFunctionAdapter({
      pool,
      datasets: datasetsPortOn(store.database),
      mostFunctions: settings.mostFunctions,
    }),
    routes: [uploadDataset(runtimeLedger(runtime).content)],
  };
}
