import { describe, expect, it } from 'vitest';

import type { CallSettled } from '../connections/server-connection.ts';
import { failureOf } from '../connections/server-failures.ts';
import { apiConnection } from './api-connection.ts';
import type { DescribedApiSettings } from './described-api.ts';

function failureOfSettled(settled: CallSettled): unknown {
  return 'error' in settled ? failureOf(settled.error) : settled;
}

const settings: DescribedApiSettings = {
  type: 'openapi',
  name: 'graph',
  document: { kind: 'url', url: 'https://graph.example.com/openapi.json' },
  base_url: null,
  headers: new Map(),
  query_params: new Map(),
  auth: null,
  org: 'acme',
  playbooks: null,
  allowed: null,
  testable: [],
  record_content: true,
  request_id: null,
  secrets: [],
  api: { baseUrl: 'https://graph.example.com/v1', operations: [] },
};

describe('the connection to an HTTP API', () => {
  it('refuses a call of a tool its document does not hold, sending nothing', async () => {
    const sent: string[] = [];
    const connection = apiConnection(settings, {
      fetch: () => {
        sent.push('a request');
        return Promise.resolve(new Response('{}'));
      },
      tokens: undefined,
      now: Date.now,
    });

    const settled = await connection.call({
      tool: 'search',
      input: {},
      meta: {},
      signal: new AbortController().signal,
      timeoutMs: 1000,
    });

    expect(failureOfSettled(settled)).toEqual({
      kind: 'refused',
      message: 'The tool server lists no tool search',
    });
    expect(sent).toEqual([]);
  });

  it('closes when it ends, holding no session', async () => {
    const connection = apiConnection(settings, { fetch: globalThis.fetch, tokens: undefined, now: Date.now });

    await connection.end();

    await expect(connection.closed).resolves.toBeUndefined();
    expect(await connection.listTools(1000)).toEqual([]);
  });
});
