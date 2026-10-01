import { readServerConfig, type Environment } from '@beonauto/config';
import { Config, ConfigProvider, Effect, Schema } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface Settings {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly apiKeysConfigured: boolean;
}

const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.origin === text || `Expected an origin such as https://app.example.com, received "${text}"`,
  ),
);

const apiSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  apiKeysConfigured: Config.String('API_KEYS').pipe(
    Config.withDefault(''),
    Config.map((keys: string) => keys.trim() !== ''),
  ),
});

export function readSettings(environment: Environment): Settings {
  const { host, port } = readServerConfig(environment);
  const read = apiSettings
    .parse(ConfigProvider.fromEnvRecord(environment))
    .pipe(Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })));
  return { host, port, ...Effect.runSync(read) };
}
