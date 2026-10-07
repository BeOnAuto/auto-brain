import { configurationOf, readServerConfig, type Environment, type FileUse } from '@beonauto/config';
import { readApiKeys, type ApiKey } from '@beonauto/identity';
import { Effect, Result } from 'effect';

import { fileSettings } from '../config-file/file-settings.ts';
import { readFunctionSettings, type FunctionSettings } from '../function-settings/function-settings.ts';
import { readAccessSettings, type AccessSettings } from './access-settings.ts';
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
  readonly workflows: WorkflowSettings;
  readonly configFile: ConfigFileSources | undefined;
}

function sourcesOf(file: FileUse | undefined): ConfigFileSources | undefined {
  return file === undefined ? undefined : { path: file.path, fromFile: file.fromFile, overridden: file.overridden };
}

export function readSettings(given: Environment): Settings {
  const { environment, file } = Result.getOrThrow(configurationOf(given, fileSettings));
  const { host, port } = readServerConfig(environment);
  const { allowedOrigins, localMode, logFormat } = Effect.runSync(readAccessSettings(environment));
  const ledger = Effect.runSync(readLedgerSettings(environment));
  const functions = readFunctionSettings(environment, file, { host, port });
  const workflows = Effect.runSync(readWorkflowSettings(environment));
  return {
    host,
    port,
    allowedOrigins,
    apiKeys: readApiKeys(environment),
    ledger,
    localMode,
    logFormat,
    ...functions,
    workflows,
    configFile: sourcesOf(file),
  };
}
