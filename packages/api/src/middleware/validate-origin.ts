import { pageOriginsOf } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const foreignOrigin = problemOf('origin_not_allowed', 'The origin of this request is not allowed');

export function validateOrigin(allowedOrigins: readonly string[]): MiddlewareHandler<ApiEnv> {
  const pageOrigins = pageOriginsOf(allowedOrigins);
  return (c, next) => {
    const origin = c.req.header('origin');
    return origin === undefined || pageOrigins.includes(origin)
      ? next()
      : Promise.resolve(problemResponse(foreignOrigin));
  };
}
