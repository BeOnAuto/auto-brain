import { afterEach, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from './lifecycle.ts';

describe('HTTP server', () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  async function request(path: string, method = 'GET'): Promise<{ status: number; body: unknown }> {
    server = await startServer({ HOST: '127.0.0.1', PORT: '0' });
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method });
    return { status: response.status, body: await response.json() };
  }

  it('reports healthy on GET /health', async () => {
    expect(await request('/health')).toEqual({ status: 200, body: { status: 'ok' } });
  });

  it('answers 404 for unknown paths', async () => {
    expect(await request('/nope')).toEqual({ status: 404, body: { error: 'not_found' } });
  });

  it('answers 404 for non-GET requests to /health', async () => {
    expect(await request('/health', 'POST')).toEqual({ status: 404, body: { error: 'not_found' } });
  });
});
