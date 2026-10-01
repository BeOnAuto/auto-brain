import { authenticatorFor, createApiKey } from '@beonauto/identity';
import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';

const acme = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' });

const keyHolders = authenticatorFor({ host: '0.0.0.0', apiKeys: [acme.entry] });

const whoIsCalling: RegisterRoutes = (routes) => {
  routes.add('GET', '/v1/orgs/:org/whoami', (c) => c.json(c.get('principal').callerIn(c.req.param('org') ?? '')));
};

const protectedPath = '/v1/orgs/acme/whoami';

const withoutAValidKey: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['no Authorization header', {}],
  ['credentials of another scheme', { authorization: 'Basic YWNtZTpzZWNyZXQ=' }],
  ['a Bearer header without a key', { authorization: 'Bearer' }],
];

describe('authentication with API keys', () => {
  it('lets a route read the caller of a configured key', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    expect(await call(handler, protectedPath, { headers: { authorization: `Bearer ${acme.key}` } })).toMatchObject({
      status: 200,
      body: { id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' },
    });
  });

  it('accepts the Bearer scheme in any letter case', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    expect(await call(handler, protectedPath, { headers: { authorization: `bearer ${acme.key}` } })).toMatchObject({
      status: 200,
    });
  });
});

describe('a request without a valid API key', () => {
  it.each(withoutAValidKey)('answers %s with 401 and a bare Bearer challenge', async (_case, headers) => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await call(handler, protectedPath, { headers });

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', type: 'https://on.auto/problems/unauthenticated' },
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('marks a presented key that is not valid as an invalid token', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await call(handler, protectedPath, {
      headers: { authorization: `Bearer abk_acme-reader_${'A'.repeat(43)}` },
    });

    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  });

  it('answers an unauthenticated request to an unknown path with 401, not 404', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    expect(await call(handler, '/nowhere')).toMatchObject({ status: 401 });
    expect(await call(handler, '/nowhere', { headers: { authorization: `Bearer ${acme.key}` } })).toMatchObject({
      status: 404,
    });
  });
});

describe('the public /health path', () => {
  it('answers GET and HEAD without a key', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    expect([
      (await call(handler, '/health')).status,
      (await call(handler, '/health', { method: 'HEAD' })).status,
    ]).toEqual([200, 200]);
  });

  it('answers any other method on /health with 405 and Allow, not 401', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    const answer = await call(handler, '/health', { method: 'POST' });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(answer.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('authentication without API keys', () => {
  it('admits nobody outside local mode, whatever key is presented', async () => {
    const { handler } = createTestHandler({
      authenticator: authenticatorFor({ host: '0.0.0.0', apiKeys: undefined }),
      routes: [whoIsCalling],
    });

    const answer = await call(handler, protectedPath, { headers: { authorization: `Bearer ${acme.key}` } });

    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  });

  it('admits every request in local mode as the local developer of the org it names', async () => {
    const { handler } = createTestHandler({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
      routes: [whoIsCalling],
    });

    expect(await call(handler, '/v1/orgs/globex/whoami', { headers: { host: 'localhost:8080' } })).toMatchObject({
      status: 200,
      body: { id: 'local', org: 'globex', brains: '*' },
    });
  });
});
