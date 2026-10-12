import { servedBy } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { shortShutdownTimeoutMs } from '../processes/short-shutdown-timeout.ts';
import { optionsServing } from './serving-options.ts';
import { testRoutes } from './test-routes.ts';

await runServer(
  process,
  { ...optionsServing(() => servedBy([testRoutes])), shutdownTimeoutMs: shortShutdownTimeoutMs },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
