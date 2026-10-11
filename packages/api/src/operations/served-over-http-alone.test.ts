import { describe, expect, it } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { call } from '../testing/api-calls.ts';
import { blobOperations } from '../testing/blob-operations.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

type Headers = Readonly<Record<string, string>>;

const asAdmin: Headers = { authorization: `Bearer ${acmeAdmin.key}` };

const asJson: Headers = { ...asAdmin, 'content-type': 'application/json' };

const asOctets: Headers = { ...asAdmin, 'content-type': 'application/octet-stream' };

const blobs = '/v1/orgs/acme/brains/alpha/blobs';

const servedOverHttpAlone = blobOperations;

function withBlobs() {
  return operationServer({ operations: [...notebookOperations, ...servedOverHttpAlone] });
}

interface Sent {
  readonly method?: string;
  readonly headers: Headers;
  readonly body?: string | ReadableStream<Uint8Array>;
}

interface Fetched {
  readonly status: number;
  readonly headers: globalThis.Headers;
  readonly text: string;
}

async function fetched(handler: ApiHandler, path: string, { method = 'GET', headers, body }: Sent): Promise<Fetched> {
  const init: RequestInit = body === undefined ? { method, headers } : { method, headers, body, duplex: 'half' };
  const response = await handler.fetch(new Request(`http://localhost${path}`, init));
  return { status: response.status, headers: response.headers, text: await response.text() };
}

interface Pulled {
  readonly stream: ReadableStream<Uint8Array>;
  readonly pulls: () => number;
}

function countingPulls(): Pulled {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulls: () => pulls };
}

interface Streamed {
  readonly body: string;
  readonly method: string;
  readonly path: string;
  readonly contentType: string;
  readonly mediaType: string;
}

const streamedBodies: readonly Streamed[] = [
  {
    body: 'an octet stream',
    method: 'POST',
    path: `${blobs}/b1`,
    contentType: 'application/octet-stream',
    mediaType: 'application/octet-stream',
  },
  {
    body: 'CSV in UTF-8',
    method: 'PUT',
    path: '/v1/orgs/acme/brains/alpha/rows/r1',
    contentType: 'text/csv; charset=utf-8',
    mediaType: 'text/csv',
  },
];

describe('an operation served over HTTP alone, answering over HTTP', () => {
  it.each(streamedBodies)(
    'hands its handler $body as a stream with its media type and length, and answers with that stream',
    async ({ method, path, contentType, mediaType }) => {
      const { handler } = await withBlobs();
      const headers = { ...asAdmin, 'content-type': contentType, 'content-length': '10' };

      const answer = await fetched(handler, path, { method, headers, body: 'series,day' });

      expect([answer.status, answer.text]).toEqual([200, 'series,day']);
      expect([answer.headers.get('content-type'), answer.headers.get('content-length')]).toEqual([mediaType, '10']);
    },
  );

  it('answers a query that takes no body with the stream it makes, and JSON where its handler answers JSON', async () => {
    const { handler } = await withBlobs();

    const read = await fetched(handler, `${blobs}/b1`, { headers: asAdmin });
    const renamed = await call(handler, `${blobs}/b1/rename`, { method: 'POST', headers: asJson, body: '{"to":"b2"}' });
    const cleared = await call(handler, `${blobs}/clear`, { method: 'POST', headers: asAdmin });

    expect([read.status, read.text, read.headers.get('content-type'), read.headers.get('cache-control')]).toEqual([
      200,
      'blob b1',
      'text/plain',
      'no-store',
    ]);
    expect([renamed.body, cleared.body]).toEqual([{ renamed: 'b2' }, { cleared: true }]);
  });

  it('answers an empty body sent with a Content-Length of 0 as an empty stream', async () => {
    const { handler } = await withBlobs();

    const answer = await fetched(handler, `${blobs}/b1`, {
      method: 'POST',
      headers: { ...asOctets, 'content-length': '0' },
    });

    expect([answer.status, answer.text, answer.headers.get('content-length')]).toEqual([200, '', '0']);
  });
});

describe('an operation served over HTTP alone, refusing a body', () => {
  it('refuses a body without a Content-Length with 411, and one longer than it takes with 413, before reading it', async () => {
    const { handler } = await withBlobs();
    const unmeasured = countingPulls();
    const oversized = countingPulls();

    const withoutLength = await fetched(handler, `${blobs}/b1`, {
      method: 'POST',
      headers: asOctets,
      body: unmeasured.stream,
    });
    const tooLong = await fetched(handler, `${blobs}/b1`, {
      method: 'POST',
      headers: { ...asOctets, 'content-length': '1025' },
      body: oversized.stream,
    });

    expect([withoutLength.status, JSON.parse(withoutLength.text)]).toEqual([
      411,
      expect.objectContaining({ reason: 'length_required', detail: 'A body must be sent with a Content-Length' }),
    ]);
    expect([tooLong.status, JSON.parse(tooLong.text)]).toEqual([
      413,
      expect.objectContaining({
        reason: 'content_too_large',
        detail: 'The body is larger than the 1,024 bytes this operation takes',
      }),
    ]);
    expect([unmeasured.pulls(), oversized.pulls()]).toEqual([0, 0]);
  });
});

describe('an operation served over HTTP alone, refusing what it was sent', () => {
  it.each<readonly [string, Headers, number, string]>([
    ['another media type', { 'content-type': 'text/csv' }, 415, 'A body must be sent as application/octet-stream'],
    [
      'a Content-Encoding',
      { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
      415,
      'A body must be sent without a Content-Encoding other than identity',
    ],
    [
      'a charset other than UTF-8',
      { 'content-type': 'application/octet-stream; charset=latin1' },
      415,
      'A body must be encoded as UTF-8',
    ],
    [
      'a Content-Length that is not a number',
      { 'content-type': 'application/octet-stream', 'content-length': 'ten' },
      400,
      'The Content-Length must be a whole number of bytes',
    ],
  ])('refuses a body sent with %s', async (_case, sent, status, detail) => {
    const { handler } = await withBlobs();

    const answer = await call(handler, `${blobs}/b1`, { method: 'POST', headers: { ...asAdmin, ...sent }, body: 'x' });

    expect(answer).toMatchObject({ status, body: { detail } });
  });

  it('refuses a body sent to a command that takes none, and a query string on any command', async () => {
    const { handler } = await withBlobs();

    const withBody = await call(handler, `${blobs}/clear`, { method: 'POST', headers: asJson, body: '{}' });
    const withQuery = await call(handler, `${blobs}/b1?size=1`, { method: 'POST', headers: asAdmin });

    expect([withBody.status, withBody.body]).toEqual([
      400,
      expect.objectContaining({ reason: 'bad_request', detail: 'This operation takes no body' }),
    ]);
    expect(withQuery.status).toBe(400);
  });
});

const endpoints = ['/mcp', '/orgs/acme/mcp', '/orgs/acme/brains/alpha/mcp'];

async function listingOn(handler: ApiHandler, path: string): Promise<string> {
  return (await postMcp(handler, path, asAdmin, requestOf(1, 'tools/list'))).text;
}

describe('an operation served over HTTP alone, over MCP', () => {
  it.each(endpoints)(
    'is listed on no endpoint, so %s lists the same bytes and tools it lists without it',
    async (path) => {
      const without = await operationServer();
      const withThem = await withBlobs();

      const listed = await listingOn(withThem.handler, path);

      expect(listed).toBe(await listingOn(without.handler, path));
      expect(
        servedOverHttpAlone.filter(({ registration }) => listed.includes(`"name":"${registration.name}"`)),
      ).toEqual([]);
    },
  );

  it('is refused as a tool call, as a tool the endpoint does not list', async () => {
    const { handler } = await withBlobs();

    const answers = await Promise.all(
      ['/orgs/acme/brains/alpha/mcp', '/mcp'].map((path) =>
        postMcp(handler, path, asAdmin, requestOf(2, 'tools/call', { name: 'read_blob', arguments: { name: 'b1' } })),
      ),
    );

    expect(answers.flatMap((answer) => messagesIn(answer))).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32_602, message: 'Tool read_blob not found' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32_602, message: 'Tool read_blob not found' } },
    ]);
  });
});
