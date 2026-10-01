import { runServer, defaultServerOptions } from '../lifecycle.ts';
import { shortShutdownTimeoutMs } from './short-shutdown-timeout.ts';
import { testRoutes } from './test-routes.ts';

await runServer(process, {
  ...defaultServerOptions,
  routes: () => [testRoutes],
  shutdownTimeoutMs: shortShutdownTimeoutMs,
});
