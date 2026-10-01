import { runServer } from '../lifecycle.ts';
import { shortShutdownDeadlineMs } from './short-shutdown-deadline.ts';
import { testRoutes } from './test-routes.ts';

await runServer(process, { routes: [testRoutes], shutdownDeadlineMs: shortShutdownDeadlineMs });
