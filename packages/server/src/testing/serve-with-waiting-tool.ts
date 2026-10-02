import { waitForever } from '@beonauto/api/testing';
import { brainOperations } from '@beonauto/brains';

import { compositionRoot } from '../composition-root.ts';
import { servedBy } from '../lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../run-server.ts';
import { routesServing } from '../served-routes.ts';
import { stopRequestedBy } from '../stop-request.ts';
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
