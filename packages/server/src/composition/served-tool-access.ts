import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { describedToolServers, makeToolAccess, type Timing, type ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { logLeftOutOperation, logServerMessage, logUntestableServer } from '../logging/tool-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export async function toolAccessOf(
  runtime: AppRuntime<DispatcherServices>,
  { toolServers }: Pick<Settings, 'toolServers'>,
  timing: Timing | undefined,
): Promise<ToolAccess> {
  const servers = await Effect.runPromise(
    describedToolServers(toolServers, {
      reportLeftOut: (server, leftOut) => {
        void runtime.run(logLeftOutOperation(server, leftOut));
      },
    }),
  );
  return makeToolAccess(servers, {
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
