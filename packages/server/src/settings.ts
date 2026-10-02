import { readServerConfig, type Environment } from '@beonauto/config';
import { readApiKeys, type ApiKey } from '@beonauto/identity';
import { readModelSettings, type ModelSettings } from '@beonauto/inference';
import { Config, ConfigProvider, Effect, Schema } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface Settings {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly ledgerFile: string;
  readonly localMode: boolean;
  readonly models: ModelSettings;
}

const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.origin === text || `Expected an origin such as https://app.example.com, received "${text}"`,
  ),
);

const serverSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  ledgerFile: Config.String('LEDGER_FILE').pipe(Config.withDefault('data/ledger.db')),
  localMode: Config.Boolean('LOCAL_MODE').pipe(Config.withDefault(false)),
});

export function readSettings(environment: Environment): Settings {
  const { host, port } = readServerConfig(environment);
  const read = serverSettings
    .parse(ConfigProvider.fromEnvRecord(environment))
    .pipe(Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })));
  const { allowedOrigins, ledgerFile, localMode } = Effect.runSync(read);
  const models = Effect.runSync(readModelSettings(environment));
  return { host, port, allowedOrigins, apiKeys: readApiKeys(environment), ledgerFile, localMode, models };
}
