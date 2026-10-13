import { describe, expect, it } from 'vitest';

import { documentOf, toolNamed, toolsOf } from '../api-testing/derived-documents.ts';
import { fakeApiDocument } from '../testing/index.ts';

describe('the tools of an HTTP API', () => {
  it('are one for each operation, with the same names, schemas and hints from a document of 3.0 as of 3.1', () => {
    const of30 = toolsOf(fakeApiDocument('3.0', '/v1'));
    const of31 = toolsOf(fakeApiDocument('3.1', '/v1'));

    expect(of30.operations).toEqual(of31.operations);
    expect(of31.leftOut.map(({ operation }) => operation)).toEqual([
      'sessionState (GET /sessions)',
      'filtered (GET /filtered)',
      'upload (POST /uploads)',
    ]);
  });

  it('take a body and the parameters of a path and of a query, with the components they refer to under $defs', () => {
    expect(toolNamed(fakeApiDocument('3.0', '/v1'), 'updateProfile')).toEqual({
      name: 'updateProfile',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The id of the profile' }, body: { $ref: '#/$defs/Profile' } },
        required: ['id', 'body'],
        additionalProperties: false,
        $defs: {
          Profile: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              title: { type: ['string', 'null'] },
              rows: { type: 'integer', exclusiveMinimum: 0, maximum: 1000 },
              manager: { $ref: '#/$defs/Person' },
            },
            required: ['name'],
          },
          Person: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
      annotations: { idempotentHint: true, openWorldHint: true },
    });
  });
});

describe('the hints and the names of the tools of an HTTP API', () => {
  it('are read-only for GET and HEAD, destructive for DELETE, idempotent for both and for PUT, and open to the world', () => {
    const tools = toolsOf(
      documentOf({ '/notes': { get: {}, head: {}, post: {}, put: {}, patch: {}, delete: {}, options: {}, trace: {} } }),
    );

    expect(tools.operations.map(({ tool }) => [tool.name, tool.annotations])).toEqual([
      ['get_notes', { readOnlyHint: true, idempotentHint: true, openWorldHint: true }],
      ['put_notes', { idempotentHint: true, openWorldHint: true }],
      ['post_notes', { openWorldHint: true }],
      ['delete_notes', { destructiveHint: true, idempotentHint: true, openWorldHint: true }],
      ['options_notes', { openWorldHint: true }],
      ['head_notes', { readOnlyHint: true, idempotentHint: true, openWorldHint: true }],
      ['patch_notes', { openWorldHint: true }],
      ['trace_notes', { openWorldHint: true }],
    ]);
  });

  it('are the operationId with what a tool name cannot hold as underscores, or the method and the path', () => {
    const tools = toolsOf(
      documentOf({
        '/Users/{userId}/Notes': { get: {}, post: { operationId: ' ' } },
        '/notes': { get: { operationId: 'notes:list v2' }, post: { operationId: `make${'x'.repeat(200)}` } },
      }),
    );

    expect(tools.operations.map(({ tool }) => tool.name)).toEqual([
      'get_users_userid_notes',
      'post_users_userid_notes',
      'notes_list_v2',
      `make${'x'.repeat(124)}`,
    ]);
  });
});

describe('the descriptions and the bodies of the tools of an HTTP API', () => {
  it('are the summary and the description of their operation, either alone, or none', () => {
    const tools = toolsOf(
      documentOf({
        '/a': { get: { summary: 'Reads a.', description: ' ' } },
        '/b': { get: { description: 'Reads b.' } },
        '/c': { get: {} },
      }),
    );

    expect(tools.operations.map(({ tool }) => tool.description)).toEqual(['Reads a.', 'Reads b.', undefined]);
  });

  it('take a body of any JSON media type, and none from a body that holds no content', () => {
    const tools = toolsOf(
      documentOf({
        '/a': { post: { requestBody: { content: { 'application/vnd.api+json; charset=utf-8': {} } } } },
        '/b': { post: { requestBody: { content: {} } } },
      }),
    );

    expect(tools.operations.map(({ tool, body }) => [tool.inputSchema, body])).toEqual([
      [
        { type: 'object', properties: { body: {} }, additionalProperties: false },
        { mediaType: 'application/vnd.api+json; charset=utf-8', required: false },
      ],
      [{ type: 'object', properties: {}, additionalProperties: false }, null],
    ]);
  });
});

describe('the parameters of the tools of an HTTP API', () => {
  it('take any value without a schema, keep the description of a schema, and offer no optional header', () => {
    const [operation] = toolsOf(
      documentOf({
        '/a': {
          get: {
            parameters: [
              { name: 'q', in: 'query', description: 'Words' },
              { name: 'n', in: 'query', description: 'A count', schema: { type: 'integer', description: 'How many' } },
              { name: 'X-Trace', in: 'header' },
              { name: 'session', in: 'cookie', required: false },
            ],
          },
        },
      }),
    ).operations;

    expect(operation?.tool.inputSchema).toEqual({
      type: 'object',
      properties: { q: { description: 'Words' }, n: { type: 'integer', description: 'How many' } },
      additionalProperties: false,
    });
    expect(operation?.inputs).toEqual([
      { name: 'q', in: 'query' },
      { name: 'n', in: 'query' },
    ]);
  });
});

describe('the parameters and the bodies an HTTP API keeps among its components', () => {
  it('are resolved, and a parameter of an operation overrides the one of its path', () => {
    const components = {
      parameters: { Limit: { $ref: '#/components/parameters/Count' }, Count: { name: 'limit', in: 'query' } },
      requestBodies: { Note: { content: { 'application/json': { schema: { type: 'string' } } } } },
    };
    const tools = toolsOf(
      documentOf(
        {
          '/a': {
            parameters: [{ $ref: '#/components/parameters/Limit' }],
            get: { parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }] },
            post: { requestBody: { $ref: '#/components/requestBodies/Note' } },
          },
        },
        { components },
      ),
    );

    expect(tools.operations.map(({ tool }) => tool.inputSchema)).toEqual([
      { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'], additionalProperties: false },
      { type: 'object', properties: { limit: {}, body: { type: 'string' } }, additionalProperties: false },
    ]);
  });
});
