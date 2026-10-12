import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countOf } from '../settings/workflow-settings.ts';
import { countProblemOf, countSourceOf, type CountBounds } from './counted-settings.ts';

export interface RecallSettings {
  readonly mostFunctions: number;
  readonly rebuildsAtOnce: number;
  readonly brainsAtOnce: number;
}

const mostFunctions: CountBounds = { setting: 'RECALL_MAX_FUNCTIONS', least: 1, most: 1000, example: 32 };

const rebuildsAtOnce: CountBounds = { setting: 'RECALL_MAX_REBUILDS', least: 1, most: 64, example: 4 };

const brainsAtOnce: CountBounds = { setting: 'RECALL_BRAINS_AT_ONCE', least: 1, most: 64, example: 4 };

const sources = Config.all({
  mostFunctions: countSourceOf(mostFunctions),
  rebuildsAtOnce: countSourceOf(rebuildsAtOnce),
  brainsAtOnce: countSourceOf(brainsAtOnce),
});

export function readRecallSettings(environment: Environment): Effect.Effect<RecallSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const settings = {
      mostFunctions: countOf(source.mostFunctions),
      rebuildsAtOnce: countOf(source.rebuildsAtOnce),
      brainsAtOnce: countOf(source.brainsAtOnce),
    };
    const problems = [
      ...countProblemOf(settings.mostFunctions, mostFunctions),
      ...countProblemOf(settings.rebuildsAtOnce, rebuildsAtOnce),
      ...countProblemOf(settings.brainsAtOnce, brainsAtOnce),
    ];
    return problems.length === 0
      ? settings
      : yield* Effect.fail(
          new InvalidSettingsError({ message: `The recall function settings are invalid. ${problems.join('; ')}` }),
        );
  });
}
