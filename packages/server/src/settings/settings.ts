import { configurationOf, readServerConfig, type Environment, type FileUse } from '@on.auto/config';
import { readApiKeys, type ApiKey } from '@on.auto/identity';
import { proxySettingsOf, type ProxySettings } from '@on.auto/outbound';
import { Effect, Result } from 'effect';

import { fileSettings } from '../config-file/file-settings.ts';
import { readFunctionSettings, type FunctionSettings } from '../function-settings/function-settings.ts';
import { readAccessSettings, type AccessSettings } from './access-settings.ts';
import { readContentSettings, type ContentSettings } from './content-settings.ts';
import { readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

interface ConfigFileSources {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
}

export interface Settings extends FunctionSettings, AccessSettings {
  readonly host: string;
  readonly port: number;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly ledger: LedgerSettings;
  readonly content: ContentSettings;
  readonly proxy: ProxySettings;
  readonly workflows: WorkflowSettings;
  readonly configFile: ConfigFileSources | undefined;
}

function sourcesOf(file: FileUse | undefined): ConfigFileSources | undefined {
  return file === undefined ? undefined : { path: file.path, fromFile: file.fromFile, overridden: file.overridden };
}

export function readSettings(given: Environment): Settings {
  const { environment, file } = Result.getOrThrow(configurationOf(given, fileSettings));
  const { host, port } = readServerConfig(environment);
  const { allowedOrigins, localMode, logFormat, logLevel } = Effect.runSync(readAccessSettings(environment));
  const ledger = Effect.runSync(readLedgerSettings(environment));
  const content = Effect.runSync(readContentSettings(environment));
  const functions = readFunctionSettings(environment, file);
  const workflows = Effect.runSync(readWorkflowSettings(environment));
  return {
    host,
    port,
    allowedOrigins,
    apiKeys: readApiKeys(environment),
    ledger,
    content,
    proxy: proxySettingsOf(environment),
    localMode,
    logFormat,
    logLevel,
    ...functions,
    workflows,
    configFile: sourcesOf(file),
  };
}
