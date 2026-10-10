import type { AppRuntime } from '@beonauto/api';
import { foundBrain } from '@beonauto/brains';
import { defineListToolServers, defineListToolServersInOrg, defineTestToolCall, type ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';
import {
  defineListModels,
  makeReasoningFunctionAdapter,
  makeModelAccess,
  type ModelAccess,
  type ModelSettings,
} from '@beonauto/reasoning';
import { Effect } from 'effect';

import { logModelProviders, logOperatorHint, logProviderMessage, logReasoning } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

export interface ServedReasoning {
  readonly capability: ReturnType<typeof makeReasoningFunctionAdapter>;
  readonly listModels: ReturnType<typeof defineListModels>;
  readonly listToolServers: ReturnType<typeof defineListToolServers>;
  readonly listToolServersInOrg: ReturnType<typeof defineListToolServersInOrg>;
  readonly testToolCall: ReturnType<typeof defineTestToolCall>;
}

export const loggedModelAccess: ModelAccessOf = (settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage, reportOperatorHint: logOperatorHint });

export async function reasoningServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'models' | 'reasoning'>,
  modelAccessOf: ModelAccessOf,
  tools: ToolAccess,
): Promise<ServedReasoning> {
  const { languageModel, status, offered, catalog } = await Effect.runPromise(modelAccessOf(settings.models));
  await runtime.run(logModelProviders(status));
  const { mostInputTokens } = settings.reasoning;
  await runtime.run(logReasoning(mostInputTokens));
  const reading = { mostInputTokens, contextWindowOf: catalog.contextWindowOf };
  return {
    capability: makeReasoningFunctionAdapter({ languageModel, offered, tools, reading }),
    listModels: defineListModels(catalog),
    listToolServers: defineListToolServers(tools),
    listToolServersInOrg: defineListToolServersInOrg(tools, foundBrain),
    testToolCall: defineTestToolCall(tools),
  };
}
