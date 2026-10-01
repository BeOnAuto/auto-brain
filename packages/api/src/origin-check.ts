import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from './api-env.ts';
import { problemOf, problemResponse } from './problem.ts';

export function refuseForeignOrigins(allowedOrigins: readonly string[]): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const origin = c.req.header('origin');
    return origin === undefined || allowedOrigins.includes(origin)
      ? next()
      : Promise.resolve(problemResponse(problemOf('origin_not_allowed', `The origin ${origin} is not allowed`)));
  };
}
