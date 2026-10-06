import type { Environment, FileUse } from '@beonauto/config';
import {
  ModelSettingsInvalid,
  providerStatus,
  readModelSettings,
  type ModelSettings,
  type SettingProblem,
} from '@beonauto/inference';
import { McpSettingsInvalid, readMcpSettings, type McpSettings } from '@beonauto/mcp';
import { Effect } from 'effect';

export interface ReasoningSettings {
  readonly models: ModelSettings;
  readonly mcp: McpSettings;
}

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function listedIn({ problems }: Problems, file: FileUse | undefined): string {
  const listed = problems.map(({ setting, detail }) =>
    file !== undefined && file.fromFile.includes(setting) ? file.placed(setting, detail) : `${setting}: ${detail}`,
  );
  return listed.join('; ');
}

function modelsPlaced(invalid: Problems, file: FileUse | undefined): ModelSettingsInvalid {
  const { problems } = invalid;
  return new ModelSettingsInvalid({ message: `The model settings are invalid. ${listedIn(invalid, file)}`, problems });
}

function serversPlaced(invalid: Problems, file: FileUse | undefined): McpSettingsInvalid {
  const { problems } = invalid;
  return new McpSettingsInvalid({
    message: `The MCP server settings are invalid. ${listedIn(invalid, file)}`,
    problems,
  });
}

function modelProvidersOf(models: ModelSettings): readonly string[] {
  const { configured, unconfigured } = providerStatus(models, { entraId: false });
  return [...configured, ...unconfigured.map(({ provider }) => provider)];
}

export function readReasoningSettings(environment: Environment, file: FileUse | undefined): ReasoningSettings {
  const models = Effect.runSync(
    readModelSettings(environment).pipe(Effect.mapError((invalid: Problems) => modelsPlaced(invalid, file))),
  );
  const mcp = Effect.runSync(
    readMcpSettings(environment, { modelProviders: modelProvidersOf(models) }).pipe(
      Effect.mapError((invalid: Problems) => serversPlaced(invalid, file)),
    ),
  );
  return { models, mcp };
}
