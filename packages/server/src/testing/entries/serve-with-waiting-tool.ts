import { waitForever } from '@on.auto/api/testing';
import type { DispatcherServices } from '@on.auto/operations';
import { playbookOperations } from '@on.auto/playbooks';

import { compositionRoot } from '../../composition/composition-root.ts';
import { routesServing } from '../../composition/served-routes.ts';
import { servedBy } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { shortShutdownTimeoutMs } from '../processes/short-shutdown-timeout.ts';

await runServer<DispatcherServices>(
  process,
  {
    ...compositionRoot,
    composed: (settings, telemetry) => ({
      ...compositionRoot.composed(settings, telemetry),
      serve: (runtime) =>
        servedBy(routesServing([...playbookOperations, waitForever], settings.identityIssuer)(runtime)),
    }),
    shutdownTimeoutMs: shortShutdownTimeoutMs,
  },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
