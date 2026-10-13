import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { apiRequestOf, type ApiEndpoint } from './api-requests.ts';
import type { ApiOperation } from './api-tools.ts';

const endpoint: ApiEndpoint = {
  baseUrl: 'https://graph.example.com/v1/',
  headers: new Map([['X-Api-Key', Redacted.make('graph-api-key-4f1d9a7c2b')]]),
  query: new Map([['tenant', Redacted.make('acme')]]),
};

const tool = { name: 'notes', inputSchema: {} };

const listing: ApiOperation = {
  tool,
  method: 'get',
  path: '/notes/{folder}/{id}',
  inputs: [
    { name: 'folder', in: 'path' },
    { name: 'id', in: 'path' },
    { name: 'tag', in: 'query' },
    { name: 'limit', in: 'query' },
  ],
  body: null,
};

const writing: ApiOperation = {
  tool,
  method: 'post',
  path: '/notes',
  inputs: [],
  body: { mediaType: 'application/merge-patch+json', required: true },
};

describe('the request of a call of an HTTP API', () => {
  it('fills the path with its encoded arguments and the query with repeated keys and the parameters of the entry', () => {
    expect(apiRequestOf(listing, { folder: 'a/b', id: 7, tag: ['x', true], limit: null }, endpoint)).toEqual(
      Result.succeed({
        url: 'https://graph.example.com/v1/notes/a%2Fb/7?tag=x&tag=true&tenant=acme',
        method: 'GET',
        headers: { 'X-Api-Key': 'graph-api-key-4f1d9a7c2b', accept: 'application/json' },
        body: null,
      }),
    );
  });

  it('joins a list given for a path parameter, and leaves out a query with nothing in it', () => {
    const bare = { ...endpoint, query: new Map() };

    expect(Result.map(apiRequestOf(listing, { folder: ['a', 'b'], id: 'c' }, bare), ({ url }) => url)).toEqual(
      Result.succeed('https://graph.example.com/v1/notes/a,b/c'),
    );
  });

  it('sends the body as JSON in the media type of the operation', () => {
    expect(apiRequestOf(writing, { body: { text: 'Hello' } }, endpoint)).toEqual(
      Result.succeed({
        url: 'https://graph.example.com/v1/notes?tenant=acme',
        method: 'POST',
        headers: {
          'X-Api-Key': 'graph-api-key-4f1d9a7c2b',
          accept: 'application/json',
          'content-type': 'application/merge-patch+json',
        },
        body: '{"text":"Hello"}',
      }),
    );
    expect(
      Result.map(
        apiRequestOf({ ...writing, body: { mediaType: 'application/json', required: false } }, {}, endpoint),
        ({ body }) => body,
      ),
    ).toEqual(Result.succeed(null));
  });
});

describe('the arguments a call of an HTTP API cannot send', () => {
  it('refuses arguments the operation does not take, a path it cannot fill, an object outside the body, or a missing body', () => {
    const refusals = [
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a', id: 'b', color: 'red' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: { name: 'a' }, id: 'b' }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(listing, { folder: 'a', id: 'b', tag: [{ name: 'x' }] }, endpoint))),
      Result.getOrThrow(Result.flip(apiRequestOf(writing, {}, endpoint))),
    ];

    expect(refusals).toEqual([
      'The arguments give color, which this operation does not take',
      'The arguments give no id, which the path of this operation needs',
      'The argument folder is an object, which a call does not send in a path or a query',
      'The argument tag is an object, which a call does not send in a path or a query',
      'The arguments give no body, which this operation needs',
    ]);
  });
});
