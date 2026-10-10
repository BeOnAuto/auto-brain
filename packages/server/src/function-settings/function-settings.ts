import type { Environment, FileUse } from '@beonauto/config';
import { Effect } from 'effect';

import { readComputationSettings, type ComputationSettings } from './computation-settings.ts';
import { readInteractionSettings, type InteractionSettings } from './interaction-settings.ts';
import { readReasoningSettings, type ReasoningSettings } from './reasoning-settings.ts';
import { readRecallSettings, type RecallSettings } from './recall-settings.ts';

export interface FunctionSettings extends ReasoningSettings {
  readonly computation: ComputationSettings;
  readonly recall: RecallSettings;
  readonly interaction: InteractionSettings;
}

export function readFunctionSettings(environment: Environment, file: FileUse | undefined): FunctionSettings {
  const { models, mcp, reasoning } = readReasoningSettings(environment, file);
  return {
    models,
    mcp,
    reasoning,
    computation: Effect.runSync(readComputationSettings(environment)),
    recall: Effect.runSync(readRecallSettings(environment)),
    interaction: readInteractionSettings(environment),
  };
}
