import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';

const allowedMethods = 'GET, HEAD, POST, PUT';

const allowedHeaders = 'authorization, content-type';

const exposedHeaders = 'x-request-id';

const preflightCacheSeconds = '600';

function answerPreflight(allowedOrigins: readonly string[]): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const origin = c.req.header('origin') ?? '';
    const isPreflight = c.req.method === 'OPTIONS' && c.req.header('access-control-request-method') !== undefined;
    return isPreflight && allowedOrigins.includes(origin)
      ? Promise.resolve(
          c.body(null, 204, {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': allowedMethods,
            'access-control-allow-headers': allowedHeaders,
            'access-control-max-age': preflightCacheSeconds,
            vary: 'Origin',
          }),
        )
      : next();
  };
}

function allowOrigin(allowedOrigins: readonly string[]): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    await next();
    const origin = c.req.header('origin') ?? '';
    c.res.headers.append('vary', 'Origin');
    if (allowedOrigins.includes(origin)) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-expose-headers', exposedHeaders);
    }
  };
}

export function corsFor(allowedOrigins: readonly string[]): readonly MiddlewareHandler<ApiEnv>[] {
  return [answerPreflight(allowedOrigins), allowOrigin(allowedOrigins)];
}
