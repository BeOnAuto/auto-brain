import { describe, expect, it } from 'vitest';

import { documentOf, toolNamed, toolsOf } from '../api-testing/derived-documents.ts';
import { fakeApiDocument } from '../testing/index.ts';

describe('an operation of an HTTP API that no tool is offered for', () => {
  it('needs a header, an object in its query or a body of another media type, and the reason is given', () => {
    expect(toolsOf(fakeApiDocument('3.1', '/v1')).leftOut).toEqual([
      {
        operation: 'sessionState (GET /sessions)',
        because: 'it needs the header X-Session, which a function cannot send',
      },
      {
        operation: 'filtered (GET /filtered)',
        because: 'its query parameter filter is an object, which a call does not send in a query',
      },
      {
        operation: 'upload (POST /uploads)',
        because: 'its body is application/xml, and a call sends a body only as JSON',
      },
    ]);
  });

  it('needs a cookie, a query of objects that may be null, or two inputs of one name', () => {
    const { leftOut } = toolsOf(
      documentOf({
        '/a': { get: { parameters: [{ name: 'session', in: 'cookie', required: true }] } },
        '/b': { get: { parameters: [{ name: 'f', in: 'query', schema: { type: ['object', 'null'] } }] } },
        '/c/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true },
              { name: 'id', in: 'query' },
            ],
          },
          post: { parameters: [{ name: 'body', in: 'query' }], requestBody: { content: { 'application/json': {} } } },
        },
      }),
    );

    expect(leftOut).toEqual([
      { operation: 'GET /a', because: 'it needs the cookie session, which a function cannot send' },
      { operation: 'GET /b', because: 'its query parameter f is an object, which a call does not send in a query' },
      { operation: 'GET /c/{id}', because: 'two of its inputs are named id' },
      { operation: 'POST /c/{id}', because: 'two of its inputs are named body' },
    ]);
  });
});

const listed = { name: 'tags', schema: { type: 'array', items: { type: 'string' } } };

describe('an operation of an HTTP API that a call could only send in another form, or not at all', () => {
  it('is TRACE, which fetch refuses, or a GET or HEAD that takes a body', () => {
    const json = { requestBody: { content: { 'application/json': {} } } };
    const { leftOut } = toolsOf(documentOf({ '/a': { trace: {}, get: json, head: json, post: json } }));

    expect(leftOut).toEqual([
      { operation: 'GET /a', because: 'it takes a body, which a GET cannot carry' },
      { operation: 'HEAD /a', because: 'it takes a body, which a HEAD cannot carry' },
      { operation: 'TRACE /a', because: 'a call cannot send TRACE, which fetch refuses' },
    ]);
  });

  it('writes a parameter in a style or with an explode other than the ones a call sends, a path as simple and a query as exploded form', () => {
    const { operations, leftOut } = toolsOf(
      documentOf({
        '/a/{id}': {
          get: { parameters: [{ name: 'id', in: 'path', required: true, style: 'label' }] },
          put: { parameters: [{ name: 'id', in: 'path', required: true, style: 'simple', explode: true }] },
        },
        '/b': {
          get: { parameters: [{ ...listed, in: 'query', explode: false }] },
          put: { parameters: [{ ...listed, in: 'query', style: 'pipeDelimited' }] },
          post: { parameters: [{ ...listed, in: 'query', style: 'form', explode: true }] },
          delete: { parameters: [{ name: 'X-Trace', in: 'header', style: 'simple', explode: true }] },
        },
      }),
    );

    expect(operations.map(({ tool }) => tool.name)).toEqual(['put_a_id', 'post_b', 'delete_b']);
    expect(leftOut).toEqual([
      {
        operation: 'GET /a/{id}',
        because: 'its path parameter id is written with style label and explode true, a form a call does not send',
      },
      {
        operation: 'GET /b',
        because: 'its query parameter tags is written with style form and explode false, a form a call does not send',
      },
      {
        operation: 'PUT /b',
        because:
          'its query parameter tags is written with style pipeDelimited and explode true, a form a call does not send',
      },
    ]);
  });
});

describe('the tools of an HTTP API, in documents of other shapes', () => {
  it('are none for a document of no paths', () => {
    expect(toolsOf({ openapi: '3.1.0' })).toEqual({ operations: [], leftOut: [] });
  });

  it('hold a component once under $defs however often their inputs refer to it, and follow a loop of components', () => {
    const day = { $ref: '#/components/schemas/Day' };
    const parameters = [
      { name: 'from', in: 'query', schema: day },
      { name: 'to', in: 'query', schema: day },
      { name: 'next', in: 'query', schema: { $ref: '#/components/schemas/Ping' } },
    ];
    const schemas = {
      Day: { type: 'string', format: 'date' },
      Ping: { $ref: '#/components/schemas/Pong' },
      Pong: { $ref: '#/components/schemas/Ping' },
    };

    const tool = toolNamed(
      documentOf({ '/a': { get: { operationId: 'a', parameters } } }, { components: { schemas } }),
      'a',
    );

    expect(tool?.inputSchema['$defs']).toEqual({
      Day: { type: 'string', format: 'date' },
      Ping: { $ref: '#/$defs/Pong' },
      Pong: { $ref: '#/$defs/Ping' },
    });
  });
});
