import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { CallSettled } from '../connections/server-connection.ts';
import { failureOf } from '../connections/server-failures.ts';
import { serveFakeApi, type FakeApiServer } from '../testing/index.ts';
import { apiConnection } from './api-connection.ts';
import type { ApiOperation } from './api-tools.ts';
import type { DescribedApiSettings } from './described-api.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function elsewhere(): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key: apiKey });
  closing.push(fake.close);
  return fake;
}

function searchAt(path: string): ApiOperation {
  return { tool: { name: 'search', inputSchema: {} }, method: 'get', path, inputs: [], body: null };
}

function calledAt(baseUrl: string, path: string): Promise<CallSettled> {
  const connection = apiConnection(
    {
      ...settings,
      headers: new Map([['X-Api-Key', Redacted.make(apiKey)]]),
      api: { baseUrl, operations: [searchAt(path)] },
    },
    { fetch: globalThis.fetch, tokens: undefined, now: Date.now },
  );
  return connection.call({
    tool: 'search',
    input: {},
    meta: {},
    signal: new AbortController().signal,
    timeoutMs: 1000,
  });
}

const outsideTheBase = {
  kind: 'failing',
  message: 'The bridge built an address outside base_url for this call, a defect of the runtime, and sent nothing',
};

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

describe('the address of a call of an HTTP API, checked before it is sent', () => {
  it('sends nothing, and no key, to another port that a path read into base_url would name', async () => {
    const other = await elsewhere();
    const port = new URL(other.origin).port;

    const settled = await calledAt(`http://127.0.0.1:${port.slice(0, -1)}`, `${port.slice(-1)}/v1/search`);

    expect(failureOfSettled(settled)).toEqual(outsideTheBase);
    expect(other.seen()).toEqual([]);
  });

  it('sends nothing to a path beside the path of base_url, which a path that does not begin with / names', async () => {
    const other = await elsewhere();

    const settled = await calledAt(`${other.origin}/v1/inner`, 'most/search');

    expect(failureOfSettled(settled)).toEqual(outsideTheBase);
    expect(other.seen()).toEqual([]);
  });
});
