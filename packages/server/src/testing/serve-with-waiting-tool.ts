import { waitForever } from '@beonauto/api/testing';
import { brainOperations } from '@beonauto/brains';

import { compositionRoot } from '../composition/composition-root.ts';
import { routesServing } from '../composition/served-routes.ts';
import { servedBy } from '../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../lifecycle/run-server.ts';
import { stopRequestedBy } from '../lifecycle/stop-request.ts';
import { shortShutdownTimeoutMs } from './short-shutdown-timeout.ts';

await runServer(
  process,
  {
    ...compositionRoot,
    serve: (runtime) => servedBy(routesServing([...brainOperations, waitForever])(runtime)),
    shutdownTimeoutMs: shortShutdownTimeoutMs,
  },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
