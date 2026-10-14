import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { isMetadataPath } from '../authentication/protected-resource.ts';
import { landingPage } from '../landing/landing-page.ts';
import { corsFor } from './cors.ts';
import { requestIdAndSecurityHeaders } from './response-headers.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

type IsPublic = (path: string) => boolean;

function publicPathsOf({ resource }: ApiOptions['authenticator'], publicPaths: ReadonlySet<string>): IsPublic {
  return (path) => publicPaths.has(path) || (resource !== undefined && isMetadataPath(path));
}

function exceptOn(isPublic: IsPublic, middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (isPublic(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor(
  { allowedOrigins, authenticator, requests }: ApiOptions,
  publicPaths: ReadonlySet<string>,
): readonly MiddlewareHandler<ApiEnv>[] {
  const isPublic = publicPathsOf(authenticator, publicPaths);
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  return [
    ...(requests === undefined ? [] : [requests]),
    landingPage,
    ...requestIdAndSecurityHeaders,
    ...[validateOrigin(allowedOrigins), ...hostValidation].map((middleware) => exceptOn(isPublic, middleware)),
    ...corsFor(allowedOrigins),
    exceptOn(isPublic, authenticate(authenticator)),
  ];
}
