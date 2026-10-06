import type { AppRuntime } from '@beonauto/api';
import {
  defineListModels,
  makeInference,
  makeModelAccess,
  type ModelAccess,
  type ModelSettings,
} from '@beonauto/inference';
import { makeToolAccess, type ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logModelProviders, logOperatorHint, logProviderMessage, logServerMessage } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

export interface ServedInference {
  readonly primitive: ReturnType<typeof makeInference>;
  readonly listModels: ReturnType<typeof defineListModels>;
  readonly withToolsClosed: (served: Served) => Served;
}

export const loggedModelAccess: ModelAccessOf = (settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage, reportOperatorHint: logOperatorHint });

function toolAccessOf(runtime: AppRuntime<DispatcherServices>, { mcp }: Pick<Settings, 'mcp'>): ToolAccess {
  return makeToolAccess(mcp, {
    reportServerMessage: (report) => {
      void runtime.run(logServerMessage(report));
    },
  });
}

function closing(tools: ToolAccess): (served: Served) => Served {
  return ({ routes, stopWork }) => ({
    routes,
    stopWork: async () => {
      await stopWork();
      await tools.close();
    },
  });
}

export async function inferenceServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'models' | 'mcp'>,
  modelAccessOf: ModelAccessOf,
): Promise<ServedInference> {
  const tools = toolAccessOf(runtime, settings);
  const { languageModel, status, offered, catalog } = await Effect.runPromise(modelAccessOf(settings.models));
  await runtime.run(logModelProviders(status));
  return {
    primitive: makeInference({ languageModel, offered, tools }),
    listModels: defineListModels(catalog),
    withToolsClosed: closing(tools),
  };
}
