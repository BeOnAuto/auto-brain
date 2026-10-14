import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { Timing } from '@on.auto/tool-servers';

import type { Served } from '../lifecycle/lifecycle.ts';
import type { Settings } from '../settings/settings.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ModelAccessOf, type ServedReasoning } from './served-reasoning.ts';
import { toolAccessOf } from './served-tool-access.ts';

export interface TimedTools {
  readonly toolTiming?: Timing;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly withToolsClosed: (served: Served) => Served;
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  modelAccessOf: ModelAccessOf,
  timing?: Timing,
): Promise<ServedToolUsers> {
  const tools = await toolAccessOf(runtime, settings, timing);
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
