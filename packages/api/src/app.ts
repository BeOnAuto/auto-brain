import { Hono } from 'hono';
import { methodNotAllowed } from 'hono/method-not-allowed';
import { secureHeaders } from 'hono/secure-headers';

import type { ApiEnv } from './api-env.ts';
import type { ApiOptions } from './api-options.ts';
import { answerFaults } from './fault-boundary.ts';
import { refuseForeignHosts } from './local-host-check.ts';
import { refuseForeignOrigins } from './origin-check.ts';
import { problemOf, problemResponse } from './problem.ts';
import { assignRequestId } from './request-id.ts';

export function createApp(options: ApiOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use(assignRequestId);
  app.use(secureHeaders({ strictTransportSecurity: false }));
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (_c, methods: readonly string[]) =>
        problemResponse(problemOf('method_not_allowed', 'The path does not support this method'), {
          allow: methods.join(', '),
        }),
    }),
  );
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.use(refuseForeignOrigins(options.allowedOrigins));
  if (options.localMode) {
    app.use(refuseForeignHosts);
  }
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
