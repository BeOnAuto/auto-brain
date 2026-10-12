import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countOf } from '../settings/workflow-settings.ts';

export interface RecallSettings {
  readonly mostFunctions: number;
  readonly rebuildsAtOnce: number;
  readonly playbooksAtOnce: number;
}

interface Bounds {
  readonly setting: string;
  readonly least: number;
  readonly most: number;
  readonly example: number;
}

const mostFunctions: Bounds = { setting: 'RECALL_MAX_FUNCTIONS', least: 1, most: 1000, example: 32 };

const rebuildsAtOnce: Bounds = { setting: 'RECALL_MAX_REBUILDS', least: 1, most: 64, example: 4 };

const playbooksAtOnce: Bounds = { setting: 'RECALL_PLAYBOOKS_AT_ONCE', least: 1, most: 64, example: 4 };

function sourceOf({ setting, example }: Bounds): Config.Config<string> {
  return Config.String(setting).pipe(Config.withDefault(String(example)));
}

const sources = Config.all({
  mostFunctions: sourceOf(mostFunctions),
  rebuildsAtOnce: sourceOf(rebuildsAtOnce),
  playbooksAtOnce: sourceOf(playbooksAtOnce),
});

function problemOf(value: number, { setting, least, most, example }: Bounds): readonly string[] {
  return value >= least && value <= most
    ? []
    : [`${setting}: Expected a whole number from ${least} to ${most}, such as ${example}`];
}

export function readRecallSettings(environment: Environment): Effect.Effect<RecallSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const settings = {
      mostFunctions: countOf(source.mostFunctions),
      rebuildsAtOnce: countOf(source.rebuildsAtOnce),
      playbooksAtOnce: countOf(source.playbooksAtOnce),
    };
    const problems = [
      ...problemOf(settings.mostFunctions, mostFunctions),
      ...problemOf(settings.rebuildsAtOnce, rebuildsAtOnce),
      ...problemOf(settings.playbooksAtOnce, playbooksAtOnce),
    ];
    return problems.length === 0
      ? settings
      : yield* Effect.fail(
          new InvalidSettingsError({ message: `The recall function settings are invalid. ${problems.join('; ')}` }),
        );
  });
}
