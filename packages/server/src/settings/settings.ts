import { configurationOf, readServerConfig, type Environment, type FileUse } from '@beonauto/config';
import { readApiKeys, type ApiKey } from '@beonauto/identity';
import { Config, ConfigProvider, Effect, Result } from 'effect';

import type { LogFormat } from '../logging/logging.ts';
import { fileSettings } from './file-settings.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';
import { readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';
import { Origin } from './origin.ts';
import { readReasoningSettings, type ReasoningSettings } from './reasoning-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

interface ConfigFileSources {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
}

export interface Settings extends ReasoningSettings {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly ledger: LedgerSettings;
  readonly localMode: boolean;
  readonly logFormat: LogFormat;
  readonly workflows: WorkflowSettings;
  readonly configFile: ConfigFileSources | undefined;
}

const serverSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  localMode: Config.Boolean('LOCAL_MODE').pipe(Config.withDefault(false)),
  logFormat: Config.Literals(['json', 'pretty'], 'LOG_FORMAT').pipe(Config.withDefault('json')),
});

function sourcesOf(file: FileUse | undefined): ConfigFileSources | undefined {
  return file === undefined ? undefined : { path: file.path, fromFile: file.fromFile, overridden: file.overridden };
}

export function readSettings(given: Environment): Settings {
  const { environment, file } = Result.getOrThrow(configurationOf(given, fileSettings));
  const { host, port } = readServerConfig(environment);
  const read = serverSettings
    .parse(ConfigProvider.fromEnvRecord(environment))
    .pipe(Effect.mapError(({ message }: { readonly message: string }) => new InvalidSettingsError({ message })));
  const { allowedOrigins, localMode, logFormat } = Effect.runSync(read);
  const ledger = Effect.runSync(readLedgerSettings(environment));
  const { models, mcp } = readReasoningSettings(environment, file);
  const workflows = Effect.runSync(readWorkflowSettings(environment));
  return {
    host,
    port,
    allowedOrigins,
    apiKeys: readApiKeys(environment),
    ledger,
    localMode,
    logFormat,
    models,
    mcp,
    workflows,
    configFile: sourcesOf(file),
  };
}
