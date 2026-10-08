import type { AppRuntime } from '@beonauto/api';
import { foundBrain } from '@beonauto/brains';
import {
  defineListModels,
  makeReasoningFunctionAdapter,
  makeModelAccess,
  type ModelAccess,
  type ModelSettings,
} from '@beonauto/inference';
import { defineListToolServers, defineListToolServersInOrg, defineTestToolCall, type ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';
import { Effect } from 'effect';

import { logModelProviders, logOperatorHint, logProviderMessage } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

export interface ServedReasoning {
  readonly primitive: ReturnType<typeof makeReasoningFunctionAdapter>;
  readonly listModels: ReturnType<typeof defineListModels>;
  readonly listToolServers: ReturnType<typeof defineListToolServers>;
  readonly listToolServersInOrg: ReturnType<typeof defineListToolServersInOrg>;
  readonly testToolCall: ReturnType<typeof defineTestToolCall>;
}

export const loggedModelAccess: ModelAccessOf = (settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage, reportOperatorHint: logOperatorHint });

export async function reasoningServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'models'>,
  modelAccessOf: ModelAccessOf,
  tools: ToolAccess,
): Promise<ServedReasoning> {
  const { languageModel, status, offered, catalog } = await Effect.runPromise(modelAccessOf(settings.models));
  await runtime.run(logModelProviders(status));
  return {
    primitive: makeReasoningFunctionAdapter({ languageModel, offered, tools }),
    listModels: defineListModels(catalog),
    listToolServers: defineListToolServers(tools),
    listToolServersInOrg: defineListToolServersInOrg(tools, foundBrain),
    testToolCall: defineTestToolCall(tools),
  };
}
