import type { Environment, FileUse } from '@beonauto/config';
import { McpSettingsInvalid, readMcpSettings, type McpSettings } from '@beonauto/mcp';
import {
  defaultMostInputTokens,
  ModelSettingsInvalid,
  providerStatus,
  readModelSettings,
  type ModelSettings,
  type SettingProblem,
} from '@beonauto/reasoning';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countOf } from '../settings/workflow-settings.ts';

export interface ReasoningBounds {
  readonly mostInputTokens: number;
}

export interface ReasoningSettings {
  readonly models: ModelSettings;
  readonly mcp: McpSettings;
  readonly reasoning: ReasoningBounds;
}

const mostInputTokens = { setting: 'REASONING_MAX_INPUT_TOKENS', least: 10_000, most: 9_999_999 };

const inputTokensSource = Config.String(mostInputTokens.setting).pipe(
  Config.withDefault(String(defaultMostInputTokens)),
);

function readReasoningBounds(environment: Environment): Effect.Effect<ReasoningBounds, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(inputTokensSource.parse(ConfigProvider.fromEnvRecord(environment)));
    const tokens = countOf(source);
    const { setting, least, most } = mostInputTokens;
    return tokens >= least && tokens <= most
      ? { mostInputTokens: tokens }
      : yield* Effect.fail(
          new InvalidSettingsError({
            message: `The reasoning function settings are invalid. ${setting}: Expected a whole number from ${least} to ${most}, such as ${defaultMostInputTokens}`,
          }),
        );
  });
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
  return { models, mcp, reasoning: Effect.runSync(readReasoningBounds(environment)) };
}
