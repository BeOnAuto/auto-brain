import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from './api-env.ts';
import { problemOf, problemResponse } from './problem.ts';

const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu;

const foreignHost = problemOf('forbidden', 'Local mode accepts only a localhost Host header');

export const refuseForeignHosts: MiddlewareHandler<ApiEnv> = (c, next) =>
  localHost.test(c.req.header('host') ?? '') ? next() : Promise.resolve(problemResponse(foreignHost));
