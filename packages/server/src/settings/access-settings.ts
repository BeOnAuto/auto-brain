import type { Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect } from 'effect';

import type { LogFormat } from '../logging/logging.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';
import { Origin } from './origin.ts';

export interface AccessSettings {
  readonly allowedOrigins: readonly string[];
  readonly localMode: boolean;
  readonly logFormat: LogFormat;
}

const accessSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  localMode: Config.Boolean('LOCAL_MODE').pipe(Config.withDefault(false)),
  logFormat: Config.Literals(['json', 'pretty'], 'LOG_FORMAT').pipe(Config.withDefault('json')),
});

export function readAccessSettings(environment: Environment): Effect.Effect<AccessSettings, InvalidSettingsError> {
  return accessSettings
    .parse(ConfigProvider.fromEnvRecord(environment))
    .pipe(Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })));
}
