import { defaultServerOptions, servedBy } from '../lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../run-server.ts';
import { stopRequestedBy } from '../stop-request.ts';
import { shortShutdownTimeoutMs } from './short-shutdown-timeout.ts';
import { testRoutes } from './test-routes.ts';

await runServer(
  process,
  { ...defaultServerOptions, serve: () => servedBy([testRoutes]), shutdownTimeoutMs: shortShutdownTimeoutMs },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
