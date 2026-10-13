import type { Environment } from '@on.auto/config';
import { readApiKeys, type ApiKey } from '@on.auto/identity';
import { Config, ConfigProvider, Effect } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';
import { Origin } from './origin.ts';

export interface AccessSettings {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly allowedOrigins: readonly string[];
  readonly localMode: boolean;
  readonly logFormat: LogFormat;
  readonly logLevel: LogLevelSetting;
}

const accessSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  localMode: Config.Boolean('LOCAL_MODE').pipe(Config.withDefault(false)),
  logFormat: Config.Literals(['json', 'pretty', 'console'], 'LOG_FORMAT').pipe(Config.withDefault('json')),
  logLevel: Config.Literals(['debug', 'info', 'warn', 'error'], 'LOG_LEVEL').pipe(Config.withDefault('info')),
});

export function readAccessSettings(environment: Environment): Effect.Effect<AccessSettings, InvalidSettingsError> {
  const apiKeys = readApiKeys(environment);
  return accessSettings.parse(ConfigProvider.fromEnvRecord(environment)).pipe(
    Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })),
    Effect.map(({ allowedOrigins, localMode, logFormat, logLevel }) => ({
      apiKeys,
      allowedOrigins,
      localMode,
      logFormat,
      logLevel,
    })),
  );
}
