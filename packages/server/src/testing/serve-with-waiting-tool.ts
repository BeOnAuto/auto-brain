import { waitForever } from '@beonauto/api/testing';
import { brainOperations } from '@beonauto/brains';

import { compositionRoot, routesServing } from '../composition-root.ts';
import { exitOnStartupFailure, runServer } from '../run-server.ts';
import { stopRequestedBy } from '../stop-request.ts';
import { shortShutdownTimeoutMs } from './short-shutdown-timeout.ts';

await runServer(
  process,
  {
    ...compositionRoot,
    routes: routesServing([...brainOperations, waitForever]),
    shutdownTimeoutMs: shortShutdownTimeoutMs,
  },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
