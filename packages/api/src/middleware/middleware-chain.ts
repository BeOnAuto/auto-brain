import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

const publicPaths: ReadonlySet<string> = new Set(['/health']);

function exceptOnPublicPaths(middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (publicPaths.has(c.req.path) ? next() : middleware(c, next));
}

export function middlewareFor({ allowedOrigins, authenticator }: ApiOptions): readonly MiddlewareHandler<ApiEnv>[] {
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  return [validateOrigin(allowedOrigins), ...hostValidation, authenticate(authenticator)].map((middleware) =>
    exceptOnPublicPaths(middleware),
  );
}
