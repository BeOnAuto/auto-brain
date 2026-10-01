import { Hono, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { ApiEnv } from '../api-env.ts';
import { assignRequestId } from './request-id.ts';

const securityHeaders = secureHeaders({
  strictTransportSecurity: false,
  xFrameOptions: 'DENY',
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
});

export const requestIdAndSecurityHeaders: readonly MiddlewareHandler<ApiEnv>[] = [assignRequestId, securityHeaders];

export function withRequestIdAndSecurityHeaders(response: Response): Promise<Response> {
  const headersApp = new Hono<ApiEnv>();
  headersApp.use(...requestIdAndSecurityHeaders);
  headersApp.all('*', () => response);
  return Promise.resolve(headersApp.fetch(new Request('http://localhost/')));
}
