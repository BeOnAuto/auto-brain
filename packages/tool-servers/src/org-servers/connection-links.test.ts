import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections } from '../testing/fake-connections.ts';
import { fakeApiKey, patientTiming, serveFakeMcp, type FakeMcpServer } from '../testing/index.ts';
import { reportingAccess } from '../testing/reporting-access.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function connectedTo(fake: FakeMcpServer, org = 'acme') {
  const connections = fakeConnections();
  connections.connect(org, {
    id: 'graph-id',
    name: 'graph',
    entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
    environment: { GRAPH_API_KEY: fakeApiKey },
  });
  const { access } = reportingAccess({}, { timing: patientTiming, connections });
  closing.push(access.close);
  return { access, connections };
}

describe('a connection checked by name and removed before any link was made to it', () => {
  it('is forgotten at the next listing, and never reached', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);
    await Effect.runPromise(access.named(alpha, [{ server: 'graph', tool: 'search' }]));

    connections.remove('graph-id');

    expect(await Effect.runPromise(access.listServers(alpha))).toEqual([]);
    expect([connections.credentialReads(), fake.seen()]).toEqual([1, []]);
  });
});

describe('a connection of another org', () => {
  it('serves none of the playbooks of this one, and is never reached from it', async () => {
    const fake = await fakeServer();
    const { access } = connectedTo(fake, 'globex');

    const refused = await Effect.runPromise(Effect.flip(access.named(alpha, [{ server: 'graph', tool: 'search' }])));

    expect(refused).toMatchObject({ because: 'tool_server_not_configured' });
    expect(await Effect.runPromise(access.listServers(alpha))).toEqual([]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('the links of connections when the access closes', () => {
  it('are stopped, ending the session a run held', async () => {
    const fake = await fakeServer();
    const { access } = connectedTo(fake);
    await Effect.runPromise(access.listServers(alpha));
    await Effect.runPromise(
      access.callOnce({ ...alpha, reference: { server: 'graph', tool: 'search' }, input: { query: 'acme' }, meta: {} }),
    );

    await access.close();

    expect(fake.openSessions()).toBe(0);
  });
});
