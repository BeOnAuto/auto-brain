import { readServerConfig, type Environment } from '@beonauto/config';
import { readApiKeys, type ApiKey } from '@beonauto/identity';
import { Config, ConfigProvider, Effect, Schema } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface Settings {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly apiKeys: readonly ApiKey[] | undefined;
}

const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.origin === text || `Expected an origin such as https://app.example.com, received "${text}"`,
  ),
);

const allowedOriginsSetting = Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([]));

export function readSettings(environment: Environment): Settings {
  const { host, port } = readServerConfig(environment);
  const allowedOrigins = allowedOriginsSetting
    .parse(ConfigProvider.fromEnvRecord(environment))
    .pipe(Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })));
  return { host, port, allowedOrigins: Effect.runSync(allowedOrigins), apiKeys: readApiKeys(environment) };
}
