import { Hono, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { ApiEnv } from '../api-env.ts';
import { assignRequestId } from './request-id.ts';

export const standardHeaders: readonly MiddlewareHandler<ApiEnv>[] = [
  assignRequestId,
  secureHeaders({ strictTransportSecurity: false }),
];

export function withStandardHeaders(response: Response): Promise<Response> {
  const answering = new Hono<ApiEnv>();
  answering.use(...standardHeaders);
  answering.all('*', () => response);
  return Promise.resolve(answering.fetch(new Request('http://localhost/')));
}
