import { configurationOf, type Environment } from '@on.auto/config';
import { providerStatus, readModelSettings } from '@on.auto/reasoning';
import { Effect, Function, Result } from 'effect';

import { fileSettings, refusedKeys } from '../config-file/file-settings.ts';

export function configuredProviders(settings: Environment): readonly string[] {
  const { environment } = Result.getOrElse(
    configurationOf(settings, fileSettings, refusedKeys),
    Function.constant({ environment: settings, file: undefined }),
  );
  return providerStatus(Effect.runSync(readModelSettings(environment)), { entraId: false }).configured;
}
