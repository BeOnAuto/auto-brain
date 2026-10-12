import type { AppRuntime } from '@on.auto/api';
import { makeToolAccess, type Timing, type ToolAccess } from '@on.auto/mcp';
import type { DispatcherServices } from '@on.auto/operations';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logServerMessage, logUntestableServer } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ModelAccessOf, type ServedReasoning } from './served-reasoning.ts';

export interface TimedTools {
  readonly toolTiming?: Timing;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly withToolsClosed: (served: Served) => Served;
}

function toolAccessOf(
  runtime: AppRuntime<DispatcherServices>,
  { mcp }: Pick<Settings, 'mcp'>,
  timing: Timing | undefined,
): ToolAccess {
  return makeToolAccess(mcp, {
    client: release,
    ...(timing === undefined ? {} : { timing }),
    content: runtimeLedger(runtime).content,
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
  timing?: Timing,
): Promise<ServedToolUsers> {
  const tools = toolAccessOf(runtime, settings, timing);
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
