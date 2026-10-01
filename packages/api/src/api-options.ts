import type { Authenticator } from '@beonauto/identity';

import type { ReportIncident } from './problem/fault-boundary.ts';
import type { RegisterRoutes } from './routes.ts';

export interface ApiOptions {
  readonly allowedOrigins: readonly string[];
  readonly authenticator: Authenticator;
  readonly routes: readonly RegisterRoutes[];
  readonly reportIncident: ReportIncident;
}
