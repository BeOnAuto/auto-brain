import { makeDispatcher, type CallerIdentity, type Outcome } from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter } from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineListToolServers } from '../index.ts';
import { reportingAccess, serveFakeMcp, type FakeMcpServer } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const reader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['brain:read'], brains: '*' };

const writerOnly: CallerIdentity = { id: 'acme-writer', org: 'acme', permissions: ['brain:write'], brains: '*' };

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryBrainRegistry([{ org: 'acme', brain: 'alpha' }], [{ org: 'acme', brain: 'old' }]),
  recordingReporter().layer,
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Asking {
  readonly brain?: string;
  readonly input?: unknown;
  readonly caller?: CallerIdentity;
}

function listingOn(fake: FakeMcpServer) {
  const { access } = reportingAccess(
    {
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      wiki: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    },
    { allowed: ['graph/echo', 'wiki/search'], environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const { registration } = defineListToolServers(access);
  return {
    registration,
    listed: ({ brain = 'alpha', input = {}, caller = reader }: Asking = {}): Promise<Outcome> =>
      Effect.runPromise(
        makeDispatcher([])
          .dispatchToBrain(registration, { caller, org: 'acme', brain, input, encoding: 'strings' })
          .pipe(Effect.provide(services)),
      ),
  };
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

const echoing = { name: 'graph', type: 'http', tools: [{ name: 'echo' }] };

const searching = { name: 'wiki', type: 'http', tools: [{ name: 'search' }] };

describe('list_tool_servers', () => {
  it('is a query of the brain at GET /tool-servers that reaches the servers outside', async () => {
    const { registration } = listingOn(await fakeServer());

    expect(registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      name: 'list_tool_servers',
      route: { method: 'GET', path: '/tool-servers' },
      reachesOutside: true,
      mayChangeOutside: false,
    });
    expect(registration.description).toMatch(
      /^Lists the tool servers this brain's functions may use, with the tools each offers, so a reasoning function names them in its tools as server\/tool or server\/\*\./u,
    );
  });

  it('answers the tool servers of the brain it is called in, or only the one named', async () => {
    const { listed } = listingOn(await fakeServer());

    expect(await listed()).toMatchObject({ status: 'succeeded', output: { tool_servers: [echoing, searching] } });
    expect(await listed({ input: { server: 'wiki' } })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [searching] },
    });
  });

  it('answers for a retired brain as every read does', async () => {
    const { listed } = listingOn(await fakeServer());

    expect(await listed({ brain: 'old' })).toMatchObject({
      status: 'succeeded',
      output: { tool_servers: [echoing, searching] },
    });
  });

  it('rejects a brain the org does not have, a name no server could have, and a caller who may not read', async () => {
    const fake = await fakeServer();
    const { listed } = listingOn(fake);

    expect(await listed({ brain: 'nowhere' })).toMatchObject({ status: 'rejected', reason: 'not_found' });
    expect(await listed({ input: { server: 'Graph/' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/server' }],
    });
    expect(await listed({ caller: writerOnly })).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(fake.seen()).toEqual([]);
  });
});

describe('list_tool_servers asked for one server', () => {
  it('rejects a name that no tool server of the brain has, saying so and how to list the ones it has', async () => {
    const fake = await fakeServer();
    const { listed } = listingOn(fake);
    const detail =
      'This brain has no tool server named mail; call list_tool_servers without server to list the ones it has';

    expect(await listed({ input: { server: 'mail' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail,
      issues: [{ detail, pointer: '/server' }],
    });
    expect(fake.seen()).toEqual([]);
  });
});
