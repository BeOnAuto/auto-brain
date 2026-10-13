import type { Authenticator } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from './api-env.ts';
import type { ReportIncident } from './problem/error-boundary.ts';
import type { RegisterRoutes } from './routes.ts';

export interface ApiOptions {
  readonly allowedOrigins: readonly string[];
  readonly authenticator: Authenticator;
  readonly routes: readonly RegisterRoutes[];
  readonly reportIncident: ReportIncident;
  readonly requests?: MiddlewareHandler<ApiEnv>;
}
