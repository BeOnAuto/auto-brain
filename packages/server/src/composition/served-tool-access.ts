import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import {
  describedToolServers,
  makeToolAccess,
  type Timing,
  type ToolAccess,
  type ToolAccessOptions,
} from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { logLeftOutOperation, logServerMessage } from '../logging/tool-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ToolAccessWiring {
  readonly toolTiming?: Timing;
  readonly telemetry?: {
    readonly traceMeta: ToolAccessOptions['traceMeta'];
  };
}

export async function toolAccessOf(
  runtime: AppRuntime<DispatcherServices>,
  { toolServers }: Pick<Settings, 'toolServers'>,
  { toolTiming, telemetry }: ToolAccessWiring,
): Promise<ToolAccess> {
  const traceMeta = telemetry?.traceMeta;
  const servers = await Effect.runPromise(
    describedToolServers(toolServers, {
      reportLeftOut: (server, leftOut) => {
        void runtime.run(logLeftOutOperation(server, leftOut));
      },
    }),
  );
  return makeToolAccess(servers, {
    client: release,
    ...(toolTiming === undefined ? {} : { timing: toolTiming }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
    content: runtimeLedger(runtime).content,
    reportServerMessage: (report) => {
      void runtime.run(logServerMessage(report));
    },
  });
}
