import { authenticatorFor } from '@beonauto/identity';
import { describe, expect, it } from 'vitest';

import { call, echoRequestId, handlerWith } from '../testing/api-calls.ts';

const localAccess = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });

describe('the Host check in local mode', () => {
  it.each(['localhost', 'localhost:8080', '127.0.0.1', '127.0.0.1:1', '[::1]', '[::1]:443', 'LocalHost:3000'])(
    'lets the Host %s through',
    async (host) => {
      const { handler } = handlerWith({ authenticator: localAccess });

      expect(await call(handler, '/nowhere', { headers: { host } })).toMatchObject({ status: 404 });
    },
  );

  it.each(['evil.example', 'localhost.evil.example', 'evil.example:8080', '127.0.0.2', '10.0.0.1:8080', ''])(
    'refuses the Host "%s" with 403',
    async (host) => {
      const { handler } = handlerWith({ authenticator: localAccess });

      expect(await call(handler, '/nowhere', { headers: { host } })).toMatchObject({
        status: 403,
        body: { reason: 'forbidden', detail: 'Local mode accepts only a localhost Host header' },
      });
    },
  );

  it('refuses a request without a Host header', async () => {
    const { handler } = handlerWith({ authenticator: localAccess });

    expect(await call(handler, '/nowhere')).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  });

  it('guards mounted routes', async () => {
    const { handler } = handlerWith({ authenticator: localAccess, routes: [echoRequestId] });

    expect(await call(handler, '/echo', { headers: { host: 'evil.example' } })).toMatchObject({ status: 403 });
    expect(await call(handler, '/echo', { headers: { host: 'localhost:8080' } })).toMatchObject({ status: 200 });
  });

  it('does not guard the health check', async () => {
    const { handler } = handlerWith({ authenticator: localAccess });

    expect(await call(handler, '/health', { headers: { host: 'evil.example' } })).toMatchObject({ status: 200 });
  });

  it('is not applied outside local mode', async () => {
    const { handler } = handlerWith();

    expect(await call(handler, '/nowhere', { headers: { host: 'evil.example' } })).toMatchObject({ status: 404 });
  });
});
