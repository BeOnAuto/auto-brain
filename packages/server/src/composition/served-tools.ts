import type { AppRuntime } from '@beonauto/api';
import { makeToolAccess, type ToolAccess } from '@beonauto/mcp';
import type { DispatcherServices } from '@beonauto/operations';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logServerMessage, logUntestableServer } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ModelAccessOf, type ServedReasoning } from './served-reasoning.ts';

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly withToolsClosed: (served: Served) => Served;
}

function toolAccessOf(runtime: AppRuntime<DispatcherServices>, { mcp }: Pick<Settings, 'mcp'>): ToolAccess {
  return makeToolAccess(mcp, {
    reportServerMessage: (report) => {
      void runtime.run(logServerMessage(report));
    },
    reportUntestable: (server) => {
      void runtime.run(logUntestableServer(server));
    },
  });
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  modelAccessOf: ModelAccessOf,
): Promise<ServedToolUsers> {
  const tools = toolAccessOf(runtime, settings);
  return {
    reasoning: await reasoningServedBy(runtime, settings, modelAccessOf, tools),
    interaction: interactionServedBy(runtime, settings, tools),
    withToolsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await tools.close();
      },
    }),
  };
}
