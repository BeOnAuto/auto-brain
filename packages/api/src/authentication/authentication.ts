import type { Authenticator } from '@beonauto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const bearerCredentials = /^Bearer +(\S+) *$/iu;

const missingKey = problemOf('unauthenticated', 'A valid API key is required');

function unauthenticated(presentedKey: string | undefined): Response {
  return problemResponse(missingKey, {
    'www-authenticate': presentedKey === undefined ? 'Bearer' : 'Bearer error="invalid_token"',
  });
}

export function requireCaller(authenticator: Authenticator): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const presentedKey = bearerCredentials.exec(c.req.header('authorization') ?? '')?.[1];
    const principal = authenticator.authenticate(presentedKey);
    if (principal === undefined) {
      return Promise.resolve(unauthenticated(presentedKey));
    }
    c.set('principal', principal);
    return next();
  };
}
