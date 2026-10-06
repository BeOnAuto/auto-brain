import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

import { serveFakeMcp } from './fake-mcp-server.ts';
import { serveOnLoopback } from './loopback-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('a loopback server whose handler fails', () => {
  it('answers 500 and records the failure instead of leaving it unhandled', async () => {
    const server = await serveOnLoopback(() => () => Promise.reject(new Error('the handler broke')));
    closing.push(server.close);

    const answer = await fetch(`${server.origin}/mcp`, { method: 'POST', body: '{}' });

    expect(answer.status).toBe(500);
    expect(await answer.text()).toBe('Error: the handler broke');
    expect(server.failures()).toEqual([{ method: 'POST', path: '/mcp', error: 'Error: the handler broke' }]);
  });

  it('records a failure of the fake MCP server beside what it saw', async () => {
    const fake = await serveFakeMcp({ client: { clientId: 'brain', clientSecret: 'secret', expiresInSeconds: null } });
    closing.push(fake.close);

    const answer = await fetch(`${fake.origin}/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from('%E0%A4%A').toString('base64')}` },
      body: 'grant_type=client_credentials',
    });

    expect(answer.status).toBe(500);
    expect(fake.failures()).toEqual([{ method: 'POST', path: '/token', error: 'URIError: URI malformed' }]);
  });
});
