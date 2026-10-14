import { dirname } from 'node:path';

import type { Environment, FileUse } from '@on.auto/config';
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
  const listed = problems.map(({ setting, detail }) =>
    file !== undefined && file.fromFile.includes(setting) ? file.placed(setting, detail) : `${setting}: ${detail}`,
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

function modelProvidersOf(models: ModelSettings): readonly string[] {
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
  return { models, toolServers, reasoning };
}
