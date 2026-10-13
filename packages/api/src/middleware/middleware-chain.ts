import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { landingPage, studioOrigin } from '../landing/landing-page.ts';
import { corsFor } from './cors.ts';
import { requestIdAndSecurityHeaders } from './response-headers.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

function exceptOnPublicPaths(
  middleware: MiddlewareHandler<ApiEnv>,
  publicPaths: ReadonlySet<string>,
): MiddlewareHandler<ApiEnv> {
  return (c, next) => (publicPaths.has(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor(
  { allowedOrigins, authenticator, requests }: ApiOptions,
  publicPaths: ReadonlySet<string>,
): readonly MiddlewareHandler<ApiEnv>[] {
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  const origins = [studioOrigin, ...allowedOrigins];
  return [
    ...(requests === undefined ? [] : [requests]),
    landingPage,
    ...requestIdAndSecurityHeaders,
    ...[validateOrigin(origins), ...hostValidation].map((middleware) => exceptOnPublicPaths(middleware, publicPaths)),
    ...corsFor(origins),
    exceptOnPublicPaths(authenticate(authenticator), publicPaths),
  ];
}
