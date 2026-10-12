import type { Environment } from '@beonauto/config';
import { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

interface ModelProcesses {
  readonly processes: number;
  readonly processMemoryMebibytes: number;
  readonly buildsAtOnce: number;
}

export interface PredictionSettings extends ModelProcesses {
  readonly path: string | undefined;
}

const processes: CountBounds = { setting: 'PREDICTION_PROCESSES', least: 2, most: 64, example: 4 };

const processMemoryMebibytes: CountBounds = {
  setting: 'PREDICTION_PROCESS_MEMORY',
  least: 384,
  most: 16_384,
  example: 512,
};

const buildsAtOnce: CountBounds = { setting: 'PREDICTION_BUILDS_AT_ONCE', least: 1, most: 63, example: 2 };

function belowTheProcesses(settings: ModelProcesses): readonly string[] {
  return settings.buildsAtOnce < settings.processes
    ? []
    : [
        `${buildsAtOnce.setting}: Expected a whole number below ${processes.setting}, ${settings.processes}, so that a prediction always finds a model process`,
      ];
}

export function readPredictionSettings(
  environment: Environment,
): Effect.Effect<PredictionSettings, InvalidSettingsError> {
  const counted = countsIn(environment, {
    settings: 'prediction function settings',
    bounds: { processes, processMemoryMebibytes, buildsAtOnce },
    beyondTheRanges: belowTheProcesses,
  });
  return Effect.map(counted, (counts) => ({ ...counts, path: environment['PATH'] }));
}
