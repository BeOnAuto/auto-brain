import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';
import { countOf } from './workflow-settings.ts';

export interface ComputationSettings {
  readonly workers: number;
}

const setting = 'COMPUTATION_WORKERS';

const least = 1;

const most = 64;

const source = Config.String(setting).pipe(Config.withDefault('4'));

export function readComputationSettings(
  environment: Environment,
): Effect.Effect<ComputationSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const workers = countOf(yield* Effect.orDie(source.parse(ConfigProvider.fromEnvRecord(environment))));
    return workers >= least && workers <= most
      ? { workers }
      : yield* Effect.fail(
          new InvalidSettingsError({
            message: `The computation settings are invalid. ${setting}: Expected a whole number from ${least} to ${most}, such as 4`,
          }),
        );
  });
}
