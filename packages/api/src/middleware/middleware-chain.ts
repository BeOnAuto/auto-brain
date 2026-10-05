import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { consoleOrigin } from '../landing/landing-page.ts';
import { corsFor } from './cors.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

const publicPaths: ReadonlySet<string> = new Set(['/health']);

function exceptOnPublicPaths(middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (publicPaths.has(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor({ allowedOrigins, authenticator }: ApiOptions): readonly MiddlewareHandler<ApiEnv>[] {
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  const origins = [consoleOrigin, ...allowedOrigins];
  return [
    ...[validateOrigin(origins), ...hostValidation].map((middleware) => exceptOnPublicPaths(middleware)),
    ...corsFor(origins),
    exceptOnPublicPaths(authenticate(authenticator)),
  ];
}
