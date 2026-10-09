import type { CallerIdentity } from '@beonauto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import {
  fakeApiKey,
  longToolName,
  patientTiming,
  reportingAccess,
  serveFakeMcp,
  toolTester,
  toolTests,
  type AccessOptions,
  type FakeMcpServer,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function entryOn(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
}

function testsOn(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}, options: AccessOptions = {}) {
  const { access } = reportingAccess(
    { graph: entryOn(fake, entry), wiki: entryOn(fake, { testable: ['echo'] }) },
    { timing: patientTiming, ...options, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  return toolTests(access);
}

const notTestable = { status: 'rejected', reason: 'unavailable', kind: 'tool_not_offered', because: 'not_testable' };

describe('a tool that cannot be tested', () => {
  it('is refused when its server gives no hint, marks it destructive, or marks it only as additive, with no call sent', async () => {
    const fake = await fakeServer();
    const { test } = testsOn(fake);

    expect([
      await test({ server: 'graph', tool: 'echo', arguments: { said: 'hello' } }),
      await test({ server: 'graph', tool: 'exit' }),
      await test({ server: 'graph', tool: longToolName }),
    ]).toMatchObject([
      {
        ...notTestable,
        detail:
          'The MCP server graph does not mark the tool echo read-only, and the operator of this server does not mark it testable',
      },
      notTestable,
      notTestable,
    ]);
    expect(fake.received()).toEqual([]);
    expect(fake.openSessions()).toBe(0);
  });

  it('is tested once the entry of its server marks it testable', async () => {
    const fake = await fakeServer();
    const { test } = testsOn(fake, { testable: ['echo'] });

    expect(await test({ server: 'graph', tool: 'echo', arguments: { said: 'hello' } })).toMatchObject({
      status: 'succeeded',
      output: { outcome: 'result', text: '{"said":"hello"}' },
    });
  });

  it('is refused when only the entry of another server marks a tool of its name testable', async () => {
    const fake = await fakeServer();
    const { test } = testsOn(fake);

    expect([
      await test({ server: 'graph', tool: 'echo', arguments: { said: 'hello' } }),
      await test({ server: 'wiki', tool: 'echo', arguments: { said: 'hello' } }),
    ]).toMatchObject([notTestable, { status: 'succeeded' }]);
    expect(fake.received()).toHaveLength(1);
  });
});

describe('a tool this brain is not offered', () => {
  it('is refused before any connection when its entry does not allow it or no server of the name serves the brain', async () => {
    const fake = await fakeServer();
    const narrowed = testsOn(fake, { allowed: ['echo'] });
    const elsewhere = testsOn(fake, { org: 'globex' });
    const otherBrains = testsOn(fake, { brains: ['sales'] });

    expect([
      await narrowed.test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } }),
      await elsewhere.test({ server: 'graph', tool: 'search' }),
      await otherBrains.test({ server: 'graph', tool: 'search' }),
      await narrowed.test({ server: 'mail', tool: 'search' }),
    ]).toMatchObject([
      {
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'tool_not_allowed',
        detail: 'The operator of this server does not allow graph/search',
      },
      { kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
      { kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
      { because: 'mcp_server_not_configured', detail: 'No MCP server named mail is configured for this brain' },
    ]);
    expect(fake.seen()).toEqual([]);
  });

  it('is refused when its server does not list it, and the session is let go', async () => {
    const fake = await fakeServer();
    const { test } = testsOn(fake);

    expect(await test({ server: 'graph', tool: 'lookup' })).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'tool_not_listed',
      detail: 'The MCP server graph does not list the tool lookup',
    });
    expect(fake.received()).toEqual([]);
    expect(fake.openSessions()).toBe(0);
  });
});

describe('a tool server that cannot be used', () => {
  it('is refused as unreachable, failing, slowing down or refusing its key, with no call sent', async () => {
    const fake = await fakeServer();
    const gone = await serveFakeMcp();
    await gone.close();
    const { test } = testsOn(fake);
    const asked = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

    const unreachable = await testsOn(gone).test(asked);
    fake.answerNextWith(503);
    const failing = await test(asked);
    fake.answerNextWith(429);
    const limited = await test(asked);
    fake.answerNextWith(401, 2);
    const refused = await test(asked);

    expect([unreachable, failing, limited, refused]).toMatchObject(
      ['unreachable', 'failing', 'rate_limited', 'key_refused'].map((because) => ({
        reason: 'unavailable',
        kind: 'mcp_server_failed',
        because,
      })),
    );
    expect(fake.received()).toEqual([]);
  });
});

describe('the words of a tool server that cannot be used for a test', () => {
  it('are cut at 1 KiB, the bound the listing and a delivery cut the same failure at', async () => {
    const fake = await fakeServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const { test } = testsOn(fake, {}, { fetch: () => Promise.reject(new Error(refusal)) });

    const refused = await test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } });

    expect(refused).toMatchObject({
      reason: 'unavailable',
      kind: 'mcp_server_failed',
      because: 'failing',
      detail: `The MCP server graph could not be used: ${refusal}`.slice(0, toolBounds.failureBytes),
    });
  });
});

describe('who may test a tool, and in which brain', () => {
  it('refuses a caller that may only read, and a brain that is retired, as every command', async () => {
    const fake = await fakeServer();
    const { test } = testsOn(fake);
    const reader: CallerIdentity = { ...toolTester, permissions: ['brain:read'] };

    expect([
      await test({ server: 'graph', tool: 'search' }, { caller: reader }),
      await test({ server: 'graph', tool: 'search' }, { brain: 'old' }),
    ]).toMatchObject([{ reason: 'forbidden' }, { reason: 'conflict', kind: 'retired' }]);
    expect(fake.seen()).toEqual([]);
  });
});
