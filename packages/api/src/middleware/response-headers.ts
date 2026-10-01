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

export async function withRequestIdAndSecurityHeaders(response: Response, requestId: string): Promise<Response> {
  const headersApp = new Hono<ApiEnv>();
  headersApp.use(securityHeaders);
  headersApp.all('*', () => response);
  const secured = await headersApp.fetch(new Request('http://localhost/'));
  secured.headers.set('x-request-id', requestId);
  return secured;
}
