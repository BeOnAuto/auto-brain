import { Hono } from 'hono';
import { methodNotAllowed } from 'hono/method-not-allowed';

import type { ApiEnv } from './api-env.ts';
import type { ApiOptions } from './api-options.ts';
import { standardHeaders } from './checks/standard-headers.ts';
import { guardsFor } from './guards.ts';
import { answerFaults } from './problem/fault-boundary.ts';
import { problemOf, problemResponse } from './problem/problem.ts';

export function createApp(options: ApiOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use(...standardHeaders);
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (_c, methods: readonly string[]) =>
        problemResponse(problemOf('method_not_allowed', 'The path does not support this method'), {
          allow: methods.toSorted().join(', '),
        }),
    }),
  );
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.use(...guardsFor(options));
  for (const register of options.routes) {
    register({
      add: (method, path, handler) => {
        app.on(method, path, handler);
      },
    });
  }
  app.notFound(() => problemResponse(problemOf('not_found', 'No route matches the path')));
  app.onError(answerFaults(options.reportIncident));
  return app;
}
