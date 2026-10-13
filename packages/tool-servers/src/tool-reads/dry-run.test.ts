import { afterEach, describe, expect, it } from 'vitest';

import { playbookToolCalls, reportingAccess, serveFakeMcp, toolReader, type FakeMcpServer } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
}

function callsOn(servers: Readonly<Record<string, unknown>>) {
  const { access } = reportingAccess(servers, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return playbookToolCalls(access);
}

const reached = { reachable: 'yes' };

describe('dry_run', () => {
  it('is a query of the playbook routed by POST at /tool-servers/{server}/tools/{tool}/dry-run', async () => {
    const { registrations } = callsOn({ graph: remote(await fakeServer()) });

    expect(registrations.dry_run).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'dry_run',
      route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/dry-run' },
      permissions: ['playbook:read'],
      reachesOutside: true,
      reasons: ['unavailable'],
    });
  });

  it('answers that execute would call an allowed tool that reads, with arguments it takes, and sends nothing', async () => {
    const fake = await fakeServer();
    const { call, recorded } = callsOn({ graph: remote(fake) });

    expect(await call('dry_run', { server: 'graph', tool: 'search', arguments: { query: 'acme' } })).toEqual({
      status: 'succeeded',
      output: {
        would_run: true,
        needs: 'playbook:write',
        caller_may: true,
        allowed: true,
        read_only: true,
        arguments: { valid: true, issues: [] },
        server: reached,
      },
    });
    expect(fake.received()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });
});

describe('dry_run of a call that would not be made', () => {
  it('answers that a caller who may only read could not execute a tool that writes, its arguments left unchecked when none are given', async () => {
    const { call } = callsOn({ graph: remote(await fakeServer()) });

    expect(await call('dry_run', { server: 'graph', tool: 'echo' }, { caller: toolReader })).toEqual({
      status: 'succeeded',
      output: {
        would_run: false,
        needs: 'playbook:write',
        caller_may: false,
        allowed: true,
        read_only: false,
        arguments: null,
        server: reached,
      },
    });
  });

  it('answers that a tool its entry does not allow would not be called, and reads nothing of it', async () => {
    const { call } = callsOn({ graph: remote(await fakeServer(), { allowed: ['search'] }) });

    expect(await call('dry_run', { server: 'graph', tool: 'echo', arguments: { said: 'hello' } })).toEqual({
      status: 'succeeded',
      output: {
        would_run: false,
        needs: 'playbook:write',
        caller_may: true,
        allowed: false,
        read_only: null,
        arguments: {
          valid: null,
          issues: [
            { path: '', message: 'Whoever runs this server does not allow the tool, so its input schema was not read' },
          ],
        },
        server: reached,
      },
    });
  });
});

describe('dry_run of a server that cannot be asked', () => {
  it('answers that a server that cannot be asked would not be called, saying why', async () => {
    const gone = await serveFakeMcp();
    await gone.close();
    const { call } = callsOn({ graph: remote(gone) });

    expect(await call('dry_run', { server: 'graph', tool: 'search', arguments: { query: 7 } })).toMatchObject({
      output: {
        would_run: false,
        allowed: true,
        read_only: null,
        arguments: { valid: null, issues: [{ path: '' }] },
        server: { reachable: 'no', because: 'unreachable' },
      },
    });
  });
});

describe('dry_run of the hints and the arguments of a tool', () => {
  it('answers whether the tool only reads as its server marks it when it lists it', async () => {
    const fake = await serveFakeMcp({ bearer: apiKey, hints: { search: { readOnlyHint: false } } });
    closing.push(fake.close);
    const { call } = callsOn({ graph: remote(fake) });

    expect(await call('dry_run', { server: 'graph', tool: 'search' })).toMatchObject({
      output: { would_run: true, read_only: false },
    });
  });

  it('answers that execute would call a tool with arguments it does not take, which the tool may refuse', async () => {
    const { call } = callsOn({ graph: remote(await fakeServer()) });

    expect(await call('dry_run', { server: 'graph', tool: 'search', arguments: { query: 7 } })).toMatchObject({
      output: { would_run: true, arguments: { valid: false, issues: [{ path: '/query' }] } },
    });
  });
});

describe('dry_run refusing', () => {
  it('refuses a server not set up for the playbook, as execute does, and a tool its server does not list', async () => {
    const fake = await fakeServer();
    const { call } = callsOn({ graph: remote(fake), crm: remote(fake, { org: 'globex' }) });

    expect([
      await call('dry_run', { server: 'crm', tool: 'search' }),
      await call('dry_run', { server: 'graph', tool: 'lookup' }),
    ]).toMatchObject([
      { reason: 'unavailable', kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
      { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed' },
    ]);
    expect(fake.received()).toEqual([]);
  });
});
