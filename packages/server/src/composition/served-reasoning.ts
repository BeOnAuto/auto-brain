import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ProxySettings } from '@on.auto/outbound';
import {
  defineListModels,
  makeReasoningFunctionAdapter,
  makeModelAccess,
  type ModelAccess,
  type ModelSettings,
  type ModelTelemetry,
} from '@on.auto/reasoning';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { logReasoning } from '../logging/logging.ts';
import { logModelProviders, logOperatorHint, logProviderMessage } from '../logging/provider-logging.ts';
import type { Settings } from '../settings/settings.ts';

export type ModelAccessOf = (
  settings: ModelSettings,
  proxy: ProxySettings,
  telemetry?: ModelTelemetry,
) => Effect.Effect<ModelAccess>;

export interface ServedReasoning {
  readonly capability: ReturnType<typeof makeReasoningFunctionAdapter>;
  readonly listModels: ReturnType<typeof defineListModels>;
}

export const loggedModelAccess: ModelAccessOf = (settings, proxy, telemetry) =>
  makeModelAccess(settings, {
    proxy,
    reportProviderMessage: logProviderMessage,
    reportOperatorHint: logOperatorHint,
    telemetry,
  });

export async function reasoningServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'models' | 'proxy' | 'reasoning'>,
  modelAccessOf: ModelAccessOf,
  tools: ToolAccess,
): Promise<ServedReasoning> {
  const { languageModel, status, offered, catalog } = await Effect.runPromise(
    modelAccessOf(settings.models, settings.proxy),
  );
  await runtime.run(logModelProviders(status));
  const { mostInputTokens } = settings.reasoning;
  await runtime.run(logReasoning(mostInputTokens));
  const reading = { mostInputTokens, contextWindowOf: catalog.contextWindowOf };
  return {
    capability: makeReasoningFunctionAdapter({ languageModel, offered, tools, reading }),
    listModels: defineListModels(catalog),
  };
}
