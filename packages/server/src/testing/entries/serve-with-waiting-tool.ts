import type { DispatcherServices } from '@on.auto/operations';
import { playbookOperations } from '@on.auto/playbooks';

import { compositionRoot } from '../../composition/composition-root.ts';
import { routesServing } from '../../composition/served-routes.ts';
import { retryStateKeyOf, secretsKeysOf } from '../../database/secrets-keys.ts';
import { servedBy } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { shortShutdownTimeoutMs } from '../processes/short-shutdown-timeout.ts';
import { waitForeverAnnouncedIn } from './announced-waiting.ts';

await runServer<DispatcherServices>(
  process,
  {
    ...compositionRoot,
    composed: (settings, telemetry) => ({
      ...compositionRoot.composed(settings, telemetry),
      serve: (runtime) =>
        servedBy(
          routesServing([...playbookOperations, waitForeverAnnouncedIn(process.env)], {
            identityIssuer: settings.identityIssuer,
            retryStateKey: retryStateKeyOf(secretsKeysOf({ key: 'made-at-start' })),
          })(runtime),
        ),
    }),
    shutdownTimeoutMs: shortShutdownTimeoutMs,
  },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
