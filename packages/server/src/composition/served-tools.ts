import type { AppRuntime } from '@on.auto/api';
import { makeToolAccess, type Timing, type ToolAccess, type ToolAccessOptions } from '@on.auto/mcp';
import type { DispatcherServices } from '@on.auto/operations';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logServerMessage, logUntestableServer } from '../logging/mcp-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ModelAccessOf, type ServedReasoning } from './served-reasoning.ts';

export interface TimedTools {
  readonly toolTiming?: Timing;
}

export interface ToolWiring extends TimedTools {
  readonly modelAccessOf: ModelAccessOf;
  readonly telemetry?: {
    readonly models: Parameters<ModelAccessOf>[2];
    readonly traceMeta: ToolAccessOptions['traceMeta'];
  };
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly withToolsClosed: (served: Served) => Served;
}

function toolAccessOf(
  runtime: AppRuntime<DispatcherServices>,
  { mcp }: Pick<Settings, 'mcp'>,
  { toolTiming, telemetry }: Omit<ToolWiring, 'modelAccessOf'>,
): ToolAccess {
  const traceMeta = telemetry?.traceMeta;
  return makeToolAccess(mcp, {
    client: release,
    ...(toolTiming === undefined ? {} : { timing: toolTiming }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
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
  { modelAccessOf, ...wiring }: ToolWiring,
): Promise<ServedToolUsers> {
  const tools = toolAccessOf(runtime, settings, wiring);
  const models = wiring.telemetry?.models;
  const access: ModelAccessOf = (modelSettings, proxy) => modelAccessOf(modelSettings, proxy, models);
  return {
    reasoning: await reasoningServedBy(runtime, settings, access, tools),
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
