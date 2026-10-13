import type { Authenticator } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import { unauthenticatedChallenge } from './challenges.ts';

const bearerCredentials = /^Bearer +([\w.~+/-]+=*) *$/iu;

const malformedCredentials = problemOf(
  'bad_request',
  'The Authorization header must hold exactly one API key or access token, as Bearer <key or token>',
);

function malformed(): Response {
  return problemResponse(malformedCredentials, { 'www-authenticate': 'Bearer error="invalid_request"' });
}

export function authenticate({ authenticate: authenticated, resource }: Authenticator): MiddlewareHandler<ApiEnv> {
  const missing = problemOf(
    'unauthenticated',
    resource === undefined ? 'A valid API key is required' : 'A valid API key or access token is required',
  );
  return async (c, next) => {
    const authorization = c.req.header('authorization');
    const presented = authorization === undefined ? undefined : bearerCredentials.exec(authorization)?.[1];
    if (authorization !== undefined && presented === undefined) {
      return malformed();
    }
    const principal = await authenticated(presented, c.req.path);
    if (principal === undefined) {
      return problemResponse(missing, {
        'www-authenticate': unauthenticatedChallenge(resource, presented !== undefined),
      });
    }
    c.set('principal', principal);
    return next();
  };
}
