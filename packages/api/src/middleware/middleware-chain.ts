import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { isMetadataPath } from '../authentication/protected-resource.ts';
import { landingPage, studioOrigin } from '../landing/landing-page.ts';
import { corsFor } from './cors.ts';
import { requestIdAndSecurityHeaders } from './response-headers.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

type IsPublic = (path: string) => boolean;

function publicPathsOf({ resource }: ApiOptions['authenticator']): IsPublic {
  return (path) => path === '/health' || (resource !== undefined && isMetadataPath(path));
}

function exceptOn(isPublic: IsPublic, middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (isPublic(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor({ allowedOrigins, authenticator }: ApiOptions): readonly MiddlewareHandler<ApiEnv>[] {
  const isPublic = publicPathsOf(authenticator);
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  const origins = [studioOrigin, ...allowedOrigins];
  return [
    landingPage,
    ...requestIdAndSecurityHeaders,
    ...[validateOrigin(origins), ...hostValidation].map((middleware) => exceptOn(isPublic, middleware)),
    ...corsFor(origins),
    exceptOn(isPublic, authenticate(authenticator)),
  ];
}
