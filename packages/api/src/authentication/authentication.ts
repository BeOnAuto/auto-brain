import { requestTokenHolderOf, type Authenticator } from '@beonauto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const bearerCredentials = /^Bearer +([\w.~+/-]+=*) *$/iu;

const requestCredentials = /^Request +([\w.~+/-]+=*) *$/iu;

const missingKey = problemOf('unauthenticated', 'A valid API key is required');

const malformedCredentials = problemOf(
  'bad_request',
  'The Authorization header must hold exactly one API key, as Bearer <key>, or the answer token of a request, as Request <token>',
);

function unauthenticated(presentedKey: string | undefined): Response {
  return problemResponse(missingKey, {
    'www-authenticate': presentedKey === undefined ? 'Bearer' : 'Bearer error="invalid_token"',
  });
}

function malformed(): Response {
  return problemResponse(malformedCredentials, { 'www-authenticate': 'Bearer error="invalid_request"' });
}

export function authenticate(authenticator: Authenticator): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const authorization = c.req.header('authorization');
    const requestToken = authorization === undefined ? undefined : requestCredentials.exec(authorization)?.[1];
    if (requestToken !== undefined) {
      c.set('principal', requestTokenHolderOf(requestToken));
      return next();
    }
    const presentedKey = authorization === undefined ? undefined : bearerCredentials.exec(authorization)?.[1];
    if (authorization !== undefined && presentedKey === undefined) {
      return Promise.resolve(malformed());
    }
    const principal = authenticator.authenticate(presentedKey);
    if (principal === undefined) {
      return Promise.resolve(unauthenticated(presentedKey));
    }
    c.set('principal', principal);
    return next();
  };
}
