import { describe, expect, it, onTestFinished } from 'vitest';

import type { HttpServerSettings } from '../settings/mcp-settings.ts';
import { serveFakeMcp } from '../testing/index.ts';
import { openHttp, systemTimer, type HttpOpening } from './http-connection.ts';

function httpSettings(url: string): HttpServerSettings {
  return {
    type: 'http',
    name: 'graph',
    url,
    headers: new Map(),
    auth: null,
    org: 'acme',
    playbooks: null,
    allowed: null,
    testable: [],
    record_content: false,
    request_id: null,
    secrets: [],
  };
}

function opening(reportError: (message: string) => void): HttpOpening {
  return {
    fetch: globalThis.fetch,
    authProvider: undefined,
    timeoutMs: 5000,
    longestRetryWaitMs: 1000,
    reportError,
    timer: systemTimer,
  };
}

describe('a connection to an MCP server', () => {
  it('tells the server it is the client @on.auto/runtime', async () => {
    const fake = await serveFakeMcp();
    onTestFinished(fake.close);
    const reported: string[] = [];

    const connection = await openHttp(
      httpSettings(fake.url),
      opening((message) => {
        reported.push(message);
      }),
    );
    await connection.end();
    const initializing = fake.seen().filter(({ rpc }) => rpc === 'initialize');

    expect(initializing.map(({ clientName }) => clientName)).toEqual(['@on.auto/runtime']);
    expect(reported).toEqual([]);
  });
});
