import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from './api-env.ts';
import type { ApiOptions } from './api-options.ts';
import { requireCaller } from './authentication/authentication.ts';
import { refuseForeignHosts } from './checks/local-host-check.ts';
import { refuseForeignOrigins } from './checks/origin-check.ts';

const publicPaths: ReadonlySet<string> = new Set(['/health']);

function exceptOnPublicPaths(guard: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (publicPaths.has(c.req.path) ? next() : guard(c, next));
}

export function guardsFor({ allowedOrigins, authenticator }: ApiOptions): readonly MiddlewareHandler<ApiEnv>[] {
  const hostCheck = authenticator.mode === 'local' ? [refuseForeignHosts] : [];
  return [refuseForeignOrigins(allowedOrigins), ...hostCheck, requireCaller(authenticator)].map((guard) =>
    exceptOnPublicPaths(guard),
  );
}
