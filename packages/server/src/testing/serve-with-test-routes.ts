import { runServer, withoutOperations } from '../lifecycle.ts';
import { shortShutdownDeadlineMs } from './short-shutdown-deadline.ts';
import { testRoutes } from './test-routes.ts';

await runServer(process, {
  ...withoutOperations,
  routes: () => [testRoutes],
  shutdownDeadlineMs: shortShutdownDeadlineMs,
});
