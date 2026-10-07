import { authenticatorFor } from '@beonauto/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { mcpClientKinds, plainTextIn, problemIn, withMcpSession, type McpSession } from '../testing/mcp-clients.ts';
import { initializeAt, messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import {
  acmeAdmin,
  acmeAlphaWriter,
  acmeReader,
  globexAdmin,
  operationServer,
  type OperationServer,
} from '../testing/operation-server.ts';
import { danglingReferencesIn } from '../testing/self-contained.ts';
import { listedTools, takingBrain, type ListedTool } from '../testing/tool-listing.ts';
import { instructionsFor } from './instructions.ts';

const orgTools = ['label_brain', 'list_labels'];

const brainTools = [
  'add_note',
  'check_lines',
  'list_notes',
  'get_note',
  'latest_note',
  'break_down',
  'wait_forever',
  'send_notes',
];

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function asKey<T>(key: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => listedTools(await session.listTools()),
  );
}

describe('the tools of /mcp', () => {
  it('are the tools of the org endpoint as they are, then those of a brain endpoint taking a brain', async () => {
    const [own, org, brain] = await Promise.all([
      listingOn('/mcp'),
      listingOn('/orgs/acme/mcp'),
      listingOn('/orgs/acme/brains/alpha/mcp'),
    ]);

    expect(own.map(({ name }) => name)).toEqual([...orgTools, ...brainTools]);
    expect(own).toEqual([...org, ...brain.map((tool) => takingBrain(tool))]);
  });

  it('have self-contained schemas with an object root', async () => {
    const tools = listedTools(await asKey(acmeAdmin.key, (session) => session.listTools()));
    const schemas = tools.flatMap(({ inputSchema, outputSchema }) => [inputSchema, outputSchema]);

    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });

  it("carry the instructions of the caller's own org", async () => {
    const instructions = await asKey(acmeAdmin.key, (session) => Promise.resolve(session.instructions));

    expect(instructions).toBe(instructionsFor('own org', { orgTools, brainTools }, []));
    expect(instructions).toContain("Every tool inside a brain takes the brain's id as brain.");
  });
});

describe('a brain tool on /mcp', () => {
  it('acts in the brain its argument names, in the org of the key', async () => {
    const outcome = await asKey(acmeAdmin.key, async (session) => ({
      added: await session.callTool('add_note', { brain: 'beta', name: 'own-org', text: 'hi' }),
      read: await session.callTool('get_note', { brain: 'beta', name: 'own-org' }),
      elsewhere: await session.callTool('get_note', { brain: 'alpha', name: 'own-org' }),
    }));

    expect(outcome.added.structuredContent).toEqual({ name: 'own-org', text: 'hi' });
    expect(outcome.read.structuredContent).toEqual({ name: 'own-org', text: 'hi' });
    expect(problemIn(outcome.elsewhere)).toMatchObject({ reason: 'not_found', detail: 'There is no note own-org' });
  });

  it('answers an operation whose input has no field, given only the brain, with its result and its plain words', async () => {
    const latest = await asKey(acmeAdmin.key, async (session) => {
      await session.callTool('add_note', { brain: 'beta', name: 'latest', text: 'the last note' });
      return session.callTool('latest_note', { brain: 'beta' });
    });

    expect(latest.isError).toBeUndefined();
    expect(latest.structuredContent).toEqual({ name: 'latest', text: 'the last note' });
    expect(plainTextIn(latest)).toBe('The latest note is “latest”.');
  });

  it('answers a call without a brain with invalid_input pointing at /brain', async () => {
    const result = await asKey(acmeAdmin.key, (session) => session.callTool('list_notes', {}));

    expect({ isError: result.isError, problem: problemIn(result) }).toMatchObject({
      isError: true,
      problem: { reason: 'invalid_input', errors: [{ detail: 'Missing key', pointer: '/brain' }] },
    });
  });

  it('answers a brain the org does not have with not_found', async () => {
    const result = await asKey(acmeAdmin.key, (session) => session.callTool('list_notes', { brain: 'nowhere' }));

    expect(problemIn(result)).toMatchObject({ reason: 'not_found', detail: 'There is no brain nowhere in this org' });
  });
});

describe('the callers of /mcp', () => {
  it('reach only the brains of their own org, whatever the arguments name', async () => {
    const outcome = await asKey(globexAdmin.key, async (session) => ({
      named: await session.callTool('list_notes', { brain: 'alpha' }),
      withOrg: await session.callTool('list_notes', { brain: 'alpha', org: 'acme' }),
      own: await session.callTool('list_notes', { brain: 'gamma' }),
    }));

    expect(problemIn(outcome.named)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no brain alpha in this org',
    });
    expect(problemIn(outcome.withOrg)).toMatchObject({ reason: 'not_found' });
    expect(outcome.own.structuredContent).toEqual({ notes: [] });
  });

  it('are refused a brain outside their key, and a command their key does not permit', async () => {
    const limited = await asKey(acmeAlphaWriter.key, (session) => session.callTool('list_notes', { brain: 'beta' }));
    const reader = await asKey(acmeReader.key, (session) =>
      session.callTool('add_note', { brain: 'alpha', name: 'read-only', text: 'no' }),
    );

    expect(problemIn(limited)).toMatchObject({ reason: 'forbidden', detail: 'The caller may not access this brain' });
    expect(problemIn(reader)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the brain:write permission',
    });
  });
});

describe('the org of /mcp without a key', () => {
  it('is local in local mode, where no key names an org', async () => {
    const local = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localMode: true }),
    });
    const onLocalhost = { host: 'localhost:8080' };

    const labelled = await postMcp(
      local.handler,
      '/mcp',
      { ...onLocalhost, 'mcp-protocol-version': '2025-11-25' },
      requestOf(1, 'tools/call', { name: 'label_brain', arguments: { brain: 'alpha', label: 'mine' } }),
    );
    const labels = await call(local.handler, '/v1/orgs/local/brain-labels', { headers: onLocalhost });

    expect(messagesIn(labelled)).toMatchObject([{ result: { structuredContent: { brain: 'alpha', label: 'mine' } } }]);
    expect(labels.body).toEqual({ labels: [{ brain: 'alpha', label: 'mine' }] });
  });

  it('answers a request without a key with a 401 challenge, and GET with 405 and Allow: POST', async () => {
    const unauthenticated = await postMcp(server.handler, '/mcp', {});
    const get = await call(server.handler, '/mcp', { headers: { authorization: `Bearer ${acmeAdmin.key}` } });

    expect({ status: unauthenticated.status, challenge: unauthenticated.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: 'Bearer',
    });
    expect({ status: get.status, allow: get.headers.get('allow') }).toEqual({ status: 405, allow: 'POST' });
  });
});

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists every tool and calls a brain tool', async () => {
    const outcome = await withMcpSession(
      kind,
      { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
      async (session) => ({
        tools: listedTools(await session.listTools()).map(({ name }) => name),
        notes: await session.callTool('list_notes', { brain: 'alpha' }),
      }),
    );

    expect(outcome.tools).toEqual([...orgTools, ...brainTools]);
    expect(outcome.notes.isError).toBeUndefined();
  });
});

describe('the revisions of /mcp', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])(
    'answers an initialize in %s in that revision',
    async (revision) => {
      const answer = await postMcp(
        server.handler,
        '/mcp',
        { authorization: `Bearer ${acmeAdmin.key}` },
        initializeAt(revision),
      );

      expect(messagesIn(answer)).toMatchObject([{ result: { protocolVersion: revision } }]);
    },
  );
});
