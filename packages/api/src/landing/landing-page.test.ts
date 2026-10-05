import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { operationServer } from '../testing/operation-server.ts';

const fromABrowser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

function open(handler: ApiHandler, address = 'http://localhost:8080/'): Promise<Response> {
  return handler.fetch(new Request(address, { headers: fromABrowser }));
}

function styleOf(page: string): string {
  return page.slice(page.indexOf('<style>') + '<style>'.length, page.indexOf('</style>'));
}

describe('the root of the server, opened in a browser', () => {
  it('is a page that says the server is running', async () => {
    const response = await open(createTestHandler().handler);

    expect({ status: response.status, type: response.headers.get('content-type') }).toEqual({
      status: 200,
      type: 'text/html; charset=UTF-8',
    });
    expect(await response.text()).toContain('<h1>Auto Brain is running</h1>');
  });

  it('shows the address the server answers at', async () => {
    const page = await (await open(createTestHandler().handler, 'http://127.0.0.1:9090/')).text();

    expect(page).toContain('<span class="address">127.0.0.1:9090</span>');
  });

  it('opens the console on this server', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(page).toContain('href="https://console.on.auto/?server=http%3A%2F%2Flocalhost%3A8080"');
  });

  it('is served without a key', async () => {
    const { handler } = await operationServer();

    expect((await open(handler)).status).toBe(200);
  });
});

describe('the page at the root of the server', () => {
  it('may run no script and load only its own styles and its fonts', async () => {
    const response = await open(createTestHandler().handler);
    const ownStyles = createHash('sha256')
      .update(styleOf(await response.text()))
      .digest('base64');

    expect(response.headers.get('content-security-policy')).toBe(
      `default-src 'none'; style-src 'sha256-${ownStyles}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });

  it('may not be framed, sniffed or cached, and sends no referrer', async () => {
    const { headers } = await open(createTestHandler().handler);

    expect({
      frameOptions: headers.get('x-frame-options'),
      contentTypeOptions: headers.get('x-content-type-options'),
      cacheControl: headers.get('cache-control'),
      referrerPolicy: headers.get('referrer-policy'),
    }).toEqual({
      frameOptions: 'DENY',
      contentTypeOptions: 'nosniff',
      cacheControl: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });
});

describe('the root of the server, for anything but a browser opening it', () => {
  it.each<Readonly<Record<string, string>>>([{}, { accept: 'application/json' }, { accept: '*/*' }])(
    'has no route for a client that accepts %j',
    async (headers: Readonly<Record<string, string>>) => {
      expect(await call(createTestHandler().handler, '/', { headers })).toMatchObject({
        status: 404,
        body: { reason: 'not_found' },
      });
    },
  );

  it('has no route for another method', async () => {
    expect(await call(createTestHandler().handler, '/', { method: 'POST', headers: fromABrowser })).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });

  it('is the only path with a page', async () => {
    expect(await call(createTestHandler().handler, '/nowhere', { headers: fromABrowser })).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });
});
