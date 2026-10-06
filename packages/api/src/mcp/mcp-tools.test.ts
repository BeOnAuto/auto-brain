import { makeSpecOperations } from '@beonauto/specs';
import { echo } from '@beonauto/specs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession, type McpConnection, type McpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { danglingReferencesIn } from '../testing/self-contained.ts';
import { listedTools } from '../testing/tool-listing.ts';

const orgOperations = notebookOperations.filter(({ registration }) => registration.scope === 'org');

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [...orgOperations, ...makeSpecOperations([echo])] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function endpoint(path: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
}

function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', endpoint('/orgs/acme/brains/alpha/mcp'), use);
}

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
];

describe('the tools of each endpoint', () => {
  it('lists the org operations on the org endpoint and no brain operation', async () => {
    const listing = await withMcpSession('current revision', endpoint('/orgs/acme/mcp'), (session) =>
      session.listTools(),
    );

    expect(listedTools(listing).map(({ name }) => name)).toEqual(['label_brain', 'list_labels']);
  });

  it('lists the ten spec operations on a brain endpoint and no org operation', async () => {
    expect(listedTools(await onAlpha((session) => session.listTools())).map(({ name }) => name)).toEqual(specTools);
  });

  it('publishes self-contained schemas with an object root, and the primitive as a plain enum', async () => {
    const tools = listedTools(await onAlpha((session) => session.listTools()));
    const schemas = tools.flatMap(({ inputSchema, outputSchema }) => [inputSchema, outputSchema]);

    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
    expect(tools.find(({ name }) => name === 'create_spec')?.inputSchema).toMatchObject({
      properties: { primitive: { type: 'string', enum: ['echo'] } },
    });
  });
});

const echoRecord = { record: { greeting: 'Hello' } };

describe('the spec tools on a brain endpoint', () => {
  it('create a spec, execute it and read the execution back', async () => {
    const outcome = await onAlpha(async (session) => {
      const created = await session.callTool('create_spec', {
        primitive: 'echo',
        name: 'greeter',
        source: '{"greeting":"Hello"}',
      });
      const executed = await session.callTool('execute_spec', {
        primitive: 'echo',
        name: 'greeter',
        input: { who: 'Ada' },
      });
      const execution = await session.callTool('get_execution', {
        execution_id: String(executed.structuredContent?.['execution_id']),
      });
      return { created, executed, execution };
    });

    expect(outcome.created.structuredContent).toMatchObject({ primitive: 'echo', name: 'greeter', version: 1 });
    expect(outcome.executed.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { greeting: 'Hello', input: { who: 'Ada' } },
    });
    expect(outcome.execution.structuredContent).toEqual({ ...outcome.executed.structuredContent, ...echoRecord });
  });

  it('list, read, update and retire a spec', async () => {
    const outcome = await onAlpha(async (session) => {
      await session.callTool('create_spec', { primitive: 'echo', name: 'welcomer', source: '{"greeting":"Hi"}' });
      const listed = await session.callTool('list_specs', { primitive: 'echo' });
      const read = await session.callTool('get_spec', { primitive: 'echo', name: 'welcomer' });
      const updated = await session.callTool('update_spec', {
        primitive: 'echo',
        name: 'welcomer',
        source: '{"greeting":"Welcome"}',
      });
      const retired = await session.callTool('retire_spec', { primitive: 'echo', name: 'welcomer' });
      return { listed, read, updated, retired };
    });

    expect(outcome.listed.structuredContent?.['specs']).toContainEqual(
      expect.objectContaining({ name: 'welcomer', version: 1 }),
    );
    expect(outcome.read.structuredContent).toMatchObject({ name: 'welcomer', version: 1, status: 'active' });
    expect(outcome.updated.structuredContent).toMatchObject({ name: 'welcomer', version: 2 });
    expect(outcome.retired.structuredContent).toMatchObject({ name: 'welcomer', status: 'retired' });
  });
});

describe('the annotations of a tool', () => {
  it('derive from the operation: read-only for a query, idempotent for GET and PUT, never destructive, open world only when it reaches outside', async () => {
    const listing = await onAlpha((session) => session.listTools());
    const annotationsByName = Object.fromEntries(
      listedTools(listing).map(({ name, annotations }) => [name, annotations]),
    );

    expect(annotationsByName).toMatchObject({
      create_spec: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
      list_specs: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
      update_spec: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
      retire_spec: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
      execute_spec: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    });
  });
});
