import { dirname } from 'node:path';

import { settingProblemText, type Environment, type FileUse } from '@on.auto/config';
import { readConnectionPolicy, type ConnectionPolicy } from '@on.auto/connections';
import {
  defaultMostInputTokens,
  ModelSettingsInvalid,
  providerStatus,
  readModelSettings,
  type ModelSettings,
  type SettingProblem,
} from '@on.auto/reasoning';
import { ToolServerSettingsInvalid, readToolServerSettings, type ToolServerSettings } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { countsIn } from './counted-settings.ts';

interface ReasoningBounds {
  readonly mostInputTokens: number;
}

export interface ReasoningSettings {
  readonly models: ModelSettings;
  readonly toolServers: ToolServerSettings;
  readonly connections: ConnectionPolicy;
  readonly reasoning: ReasoningBounds;
}

const bounds = {
  mostInputTokens: {
    setting: 'REASONING_MAX_INPUT_TOKENS',
    least: 10_000,
    most: 9_999_999,
    example: defaultMostInputTokens,
  },
};

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function listedIn({ problems }: Problems, file: FileUse | undefined): string {
  const listed = problems.map((problem) =>
    file !== undefined && file.fromFile.includes(problem.setting) ? file.placed(problem) : settingProblemText(problem),
  );
  return listed.join('; ');
}

function modelsPlaced(invalid: Problems, file: FileUse | undefined): ModelSettingsInvalid {
  const { problems } = invalid;
  return new ModelSettingsInvalid({ message: `The model settings are invalid. ${listedIn(invalid, file)}`, problems });
}

function serversPlaced(invalid: Problems, file: FileUse | undefined): ToolServerSettingsInvalid {
  const { problems } = invalid;
  return new ToolServerSettingsInvalid({
    message: `The tool server settings are invalid. ${listedIn(invalid, file)}`,
    problems,
  });
}

export function modelProvidersOf(models: ModelSettings): readonly string[] {
  const { configured, unconfigured } = providerStatus(models, { entraId: false });
  return [...configured, ...unconfigured.map(({ provider }) => provider)];
}

export function readReasoningSettings(environment: Environment, file: FileUse | undefined): ReasoningSettings {
  const models = Effect.runSync(
    readModelSettings(environment).pipe(Effect.mapError((invalid: Problems) => modelsPlaced(invalid, file))),
  );
  const toolServers = Effect.runSync(
    readToolServerSettings(environment, {
      modelProviders: modelProvidersOf(models),
      ...(file === undefined ? {} : { documentsDirectory: dirname(file.path) }),
    }).pipe(Effect.mapError((invalid: Problems) => serversPlaced(invalid, file))),
  );
  const reasoning = Effect.runSync(countsIn(environment, { settings: 'reasoning function settings', bounds }));
  const connections = Effect.runSync(readConnectionPolicy(environment));
  return { models, toolServers, connections, reasoning };
}
