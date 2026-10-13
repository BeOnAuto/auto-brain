import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { guidesPathPrefix } from '../guides/guide-routes.ts';
import { studioOrigin } from '../landing/landing-page.ts';
import { openApiPath } from '../openapi/openapi-routes.ts';
import { corsFor } from './cors.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

const publicPaths: ReadonlySet<string> = new Set(['/health', openApiPath]);

function isPublic(path: string): boolean {
  return publicPaths.has(path) || path.startsWith(guidesPathPrefix);
}

function exceptOnPublicPaths(middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (isPublic(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor({ allowedOrigins, authenticator }: ApiOptions): readonly MiddlewareHandler<ApiEnv>[] {
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  const origins = [studioOrigin, ...allowedOrigins];
  return [
    ...[validateOrigin(origins), ...hostValidation].map((middleware) => exceptOnPublicPaths(middleware)),
    ...corsFor(origins),
    exceptOnPublicPaths(authenticate(authenticator)),
  ];
}
