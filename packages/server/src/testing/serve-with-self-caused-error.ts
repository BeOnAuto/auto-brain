import type { RegisterRoutes } from '@beonauto/api';

import { defaultServerOptions, servedBy } from '../lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../run-server.ts';
import { stopRequestedBy } from '../stop-request.ts';

const selfCaused = new Error('an error whose cause is itself');
selfCaused.cause = selfCaused;

const selfCausedRoute: RegisterRoutes = (routes) => {
  routes.add('GET', '/self-caused', () => {
    throw selfCaused;
  });
};

await runServer(
  process,
  { ...defaultServerOptions, serve: () => servedBy([selfCausedRoute]) },
  stopRequestedBy(process),
).catch(exitOnStartupFailure(process));
