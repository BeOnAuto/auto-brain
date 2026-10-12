import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countOf } from '../settings/workflow-settings.ts';
import { countProblemOf, countSourceOf, type CountBounds } from './counted-settings.ts';

export interface PredictionSettings {
  readonly processes: number;
  readonly processMemoryMebibytes: number;
  readonly buildsAtOnce: number;
}

const processes: CountBounds = { setting: 'PREDICTION_PROCESSES', least: 2, most: 64, example: 4 };

const processMemory: CountBounds = { setting: 'PREDICTION_PROCESS_MEMORY', least: 128, most: 16_384, example: 512 };

const buildsAtOnce: CountBounds = { setting: 'PREDICTION_BUILDS_AT_ONCE', least: 1, most: 63, example: 2 };

const sources = Config.all({
  processes: countSourceOf(processes),
  processMemoryMebibytes: countSourceOf(processMemory),
  buildsAtOnce: countSourceOf(buildsAtOnce),
});

function belowTheProcesses(settings: PredictionSettings): readonly string[] {
  return settings.buildsAtOnce < settings.processes
    ? []
    : [
        `${buildsAtOnce.setting}: Expected a whole number below ${processes.setting}, ${settings.processes}, so that a prediction always finds a model process`,
      ];
}

export function readPredictionSettings(
  environment: Environment,
): Effect.Effect<PredictionSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const settings = {
      processes: countOf(source.processes),
      processMemoryMebibytes: countOf(source.processMemoryMebibytes),
      buildsAtOnce: countOf(source.buildsAtOnce),
    };
    const outOfRange = [
      ...countProblemOf(settings.processes, processes),
      ...countProblemOf(settings.processMemoryMebibytes, processMemory),
      ...countProblemOf(settings.buildsAtOnce, buildsAtOnce),
    ];
    const problems = outOfRange.length === 0 ? belowTheProcesses(settings) : outOfRange;
    return problems.length === 0
      ? settings
      : yield* Effect.fail(
          new InvalidSettingsError({ message: `The prediction function settings are invalid. ${problems.join('; ')}` }),
        );
  });
}
