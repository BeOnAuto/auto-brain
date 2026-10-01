import { describe, expect, it } from 'vitest';

import { call, echoRequestId, createTestHandler } from '../testing/api-calls.ts';

const allowed = 'https://app.example';

describe('the Origin check', () => {
  it('lets a request without an Origin header through', async () => {
    expect(await call(createTestHandler().handler, '/nowhere')).toMatchObject({ status: 404 });
  });

  it('lets an allowed origin through', async () => {
    const { handler } = createTestHandler({ allowedOrigins: [allowed] });

    expect(await call(handler, '/nowhere', { headers: { origin: allowed } })).toMatchObject({ status: 404 });
  });

  it.each([
    'https://evil.example',
    'http://app.example',
    'https://app.example:8443',
    'https://app.example.evil',
    'null',
    '',
  ])('rejects the origin "%s" with 403', async (origin) => {
    const { handler } = createTestHandler({ allowedOrigins: [allowed] });

    expect(await call(handler, '/nowhere', { headers: { origin } })).toMatchObject({
      status: 403,
      body: { reason: 'origin_not_allowed', detail: 'The origin of this request is not allowed' },
    });
  });

  it('validates requests to mounted routes', async () => {
    const { handler } = createTestHandler({ routes: [echoRequestId] });

    expect(await call(handler, '/echo', { headers: { origin: 'https://evil.example' } })).toMatchObject({
      status: 403,
    });
  });

  it('does not validate requests to the health check', async () => {
    const { handler } = createTestHandler();

    expect(await call(handler, '/health', { headers: { origin: 'https://evil.example' } })).toMatchObject({
      status: 200,
    });
  });
});
