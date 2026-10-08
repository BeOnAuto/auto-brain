import { NotFound, makeDispatcher, type CallerIdentity, type Outcome } from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter } from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineListToolServersInOrg } from '../index.ts';
import { reportingAccess, serveFakeMcp, type FakeMcpServer } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const orgReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' };

const brainReader: CallerIdentity = { id: 'acme-brains', org: 'acme', permissions: ['brain:read'], brains: '*' };

const alphaReader: CallerIdentity = {
  id: 'acme-alpha',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: ['alpha'],
};

const writerOnly: CallerIdentity = { id: 'acme-writer', org: 'acme', permissions: ['brain:write'], brains: '*' };

const brainsOfTheOrg: readonly string[] = ['alpha', 'beta'];

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryBrainRegistry(brainsOfTheOrg.map((brain) => ({ org: 'acme', brain }))),
  recordingReporter().layer,
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Asking {
  readonly input?: unknown;
  readonly caller?: CallerIdentity;
}

function lookUpBrain(brain: string): Effect.Effect<void, NotFound> {
  return brainsOfTheOrg.includes(brain)
    ? Effect.void
    : Effect.fail(new NotFound({ detail: `There is no brain ${brain} in this org` }));
}

function remote(fake: FakeMcpServer, scope: Readonly<Record<string, unknown>>) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, ...scope };
}

function listingOn(fake: FakeMcpServer) {
  const { access } = reportingAccess(
    {
      graph: remote(fake, { org: 'acme' }),
      notes: remote(fake, { org: 'acme', brains: ['beta', 'alpha'] }),
      sales: remote(fake, { org: 'acme', brains: ['beta'] }),
      crm: remote(fake, { org: 'globex' }),
    },
    { allowed: ['graph/echo', 'notes/search', 'sales/echo', 'crm/echo'], environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const { registration } = defineListToolServersInOrg(access, lookUpBrain);
  return {
    registration,
    listed: ({ input = {}, caller = orgReader }: Asking = {}): Promise<Outcome> =>
      Effect.runPromise(
        makeDispatcher([])
          .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
          .pipe(Effect.provide(services)),
      ),
  };
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

const echoing = { name: 'graph', type: 'http', brains: ['*'], tools: [{ name: 'echo' }] };

const searching = { name: 'notes', type: 'http', brains: ['beta', 'alpha'], tools: [{ name: 'search' }] };

const selling = { name: 'sales', type: 'http', brains: ['beta'], tools: [{ name: 'echo' }] };

describe('list_tool_servers of the org', () => {
  it('is a query of the org at GET /tool-servers, permitted to a key that may read the org or a brain', async () => {
    const { registration } = listingOn(await fakeServer());

    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_tool_servers',
      route: { method: 'GET', path: '/tool-servers' },
      permissions: ['org:read', 'brain:read'],
      targetsBrain: true,
      reachesOutside: true,
      mayChangeOutside: false,
    });
    expect(registration.description).toMatch(
      /^Lists the tool servers this brain's functions may use, .* Without `brain` it answers for the whole org, naming the brains each server serves\.$/u,
    );
  });

  it('answers without a brain every tool server of the org, each with the brains it serves', async () => {
    const { listed } = listingOn(await fakeServer());

    expect(await listed()).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [echoing, searching, selling] },
    });
    expect(await listed({ caller: brainReader })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [echoing, searching, selling] },
    });
  });

  it('answers with a brain the tool servers that serve it, as the brain itself lists them', async () => {
    const { listed } = listingOn(await fakeServer());

    expect(await listed({ input: { brain: 'alpha' } })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [echoing, searching] },
    });
    expect(await listed({ input: { brain: 'beta', server: 'sales' } })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [selling] },
    });
  });
});

describe('list_tool_servers of the org, to a key limited to some brains', () => {
  it('names only the brains it may access', async () => {
    const { listed } = listingOn(await fakeServer());

    expect(await listed({ input: { brain: 'alpha' }, caller: alphaReader })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [echoing, { ...searching, brains: ['alpha'] }] },
    });
  });
});

describe('list_tool_servers of the org, refusing', () => {
  it('refuses the whole org to a key limited to some brains, another brain to it, and a key that may read neither', async () => {
    const fake = await fakeServer();
    const { listed } = listingOn(fake);

    expect(await listed({ caller: alphaReader })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may access only some brains of this org; name one of them in brain',
    });
    expect(await listed({ input: { brain: 'beta' }, caller: alphaReader })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
    expect(await listed({ caller: writerOnly })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller lacks the org:read or brain:read permission',
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('list_tool_servers of the org, asked for a brain the org does not have', () => {
  it('rejects it as the brain itself would be, and asks no server', async () => {
    const fake = await fakeServer();
    const { listed } = listingOn(fake);

    expect(await listed({ input: { brain: 'nowhere' } })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('list_tool_servers of the org, asked for a server it does not have', () => {
  it('rejects a name no tool server of the org, or of the brain asked for, has, saying which', async () => {
    const fake = await fakeServer();
    const { listed } = listingOn(fake);

    expect(await listed({ input: { server: 'mail' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'This org has no tool server named mail; call list_tool_servers without server to list the ones it has',
      issues: [{ pointer: '/server' }],
    });
    expect(await listed({ input: { brain: 'alpha', server: 'sales' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'This brain has no tool server named sales; call list_tool_servers without server to list the ones it has',
    });
    expect(await listed({ input: { brain: 'Not A Brain' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/brain' }],
    });
    expect(fake.seen()).toEqual([]);
  });
});
