import { configurationOf, readServerConfig, type Environment, type FileUse } from '@beonauto/config';
import { readApiKeys, type ApiKey } from '@beonauto/identity';
import { Effect, Result } from 'effect';

import { readAccessSettings, type AccessSettings } from './access-settings.ts';
import { readComputationSettings, type ComputationSettings } from './computation-settings.ts';
import { fileSettings } from './file-settings.ts';
import { readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';
import { readReasoningSettings, type ReasoningSettings } from './reasoning-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

interface ConfigFileSources {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
}

export interface Settings extends ReasoningSettings, AccessSettings {
  readonly host: string;
  readonly port: number;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly ledger: LedgerSettings;
  readonly workflows: WorkflowSettings;
  readonly computation: ComputationSettings;
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
  const { models, mcp } = readReasoningSettings(environment, file);
  const workflows = Effect.runSync(readWorkflowSettings(environment));
  const computation = Effect.runSync(readComputationSettings(environment));
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
    computation,
    configFile: sourcesOf(file),
  };
}
