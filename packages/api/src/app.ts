import { Hono } from 'hono';
import { methodNotAllowed } from 'hono/method-not-allowed';

import type { ApiEnv } from './api-env.ts';
import type { ApiOptions } from './api-options.ts';
import { middlewareFor } from './middleware/middleware-chain.ts';
import { requestIdAndSecurityHeaders } from './middleware/response-headers.ts';
import { errorHandler, failureOfThrown } from './problem/error-boundary.ts';
import { problemOf, problemResponse } from './problem/problem.ts';
import type { Close } from './routes.ts';

export interface ApiApp {
  readonly app: Hono<ApiEnv>;
  readonly close: Close;
}

export function createApp(options: ApiOptions): ApiApp {
  const app = new Hono<ApiEnv>();
  const closes: Close[] = [];
  app.use(...requestIdAndSecurityHeaders);
  app.use(...middlewareFor(options));
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (_c, methods: readonly string[]) =>
        problemResponse(problemOf('method_not_allowed', 'The path does not support this method'), {
          allow: methods.toSorted().join(', '),
        }),
    }),
  );
  app.get('/health', (c) => c.json({ status: 'ok' }, 200, { 'cache-control': 'no-store' }));
  const reportThrown = failureOfThrown(options.reportIncident);
  for (const register of options.routes) {
    register({
      add: (method, path, handler) => {
        app.on(method, path, handler);
      },
      onClose: (close) => {
        closes.push(close);
      },
      reportThrown,
    });
  }
  app.notFound(() => problemResponse(problemOf('not_found', 'No route matches the path')));
  const handleError = errorHandler(options.reportIncident);
  app.onError((error: Readonly<Error>, c) => handleError(error, c.get('requestId')));
  return {
    app,
    close: async () => {
      await Promise.all(closes.map((close) => close()));
    },
  };
}
