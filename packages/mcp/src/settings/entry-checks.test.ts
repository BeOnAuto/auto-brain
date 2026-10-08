import { servesBrain } from '@beonauto/config';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readMcpSettings, type Environment, type McpServerSettings } from '../index.ts';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

const secret = { GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2' };

function environmentOf(servers: unknown): Environment {
  return { ...secret, MCP_SERVERS: JSON.stringify(servers) };
}

function settingsOf(servers: unknown) {
  return Effect.runSync(readMcpSettings(environmentOf(servers), context));
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(readMcpSettings(environmentOf(servers), context))).problems.map(
    ({ setting, detail }) => `${setting} ${detail}`,
  );
}

function served(server: McpServerSettings | undefined, org: string, brain: string): boolean {
  return server !== undefined && servesBrain(server, { org, brain });
}

describe('an auth block', () => {
  it('reads a client secret, or a private key with its algorithm, its issuer pinned', () => {
    const auth = { client_id: 'brain', scope: 'graph.read' };
    const { servers } = settingsOf({
      graph: {
        ...graph,
        auth: { ...auth, issuer: 'https://auth.example.com', client_secret: '${GRAPH_CLIENT_SECRET}' },
      },
      local: {
        url: 'http://127.0.0.1:19700/mcp',
        org: 'acme',
        auth: {
          client_id: 'brain',
          issuer: 'http://localhost:19701',
          private_key: '${GRAPH_CLIENT_SECRET}',
          algorithm: 'RS256',
        },
      },
    });

    expect(servers).toMatchObject([
      { auth: { issuer: 'https://auth.example.com', ...auth, credential: { kind: 'client_secret' } } },
      {
        auth: {
          issuer: 'http://localhost:19701',
          scope: null,
          credential: { kind: 'private_key', algorithm: 'RS256' },
        },
      },
    ]);
  });

  it('refuses an issuer that cannot be pinned, and an auth block beside an Authorization header', () => {
    const auth = { client_id: 'brain', client_secret: '${GRAPH_CLIENT_SECRET}' };
    const headers = { authorization: 'Bearer ${GRAPH_CLIENT_SECRET}' };

    expect(
      problemsOf({
        graph: { ...graph, headers, auth: { ...auth, issuer: 'http://auth.example.com' } },
        other: { ...graph, auth: { ...auth, issuer: 'not a url' } },
      }),
    ).toEqual([
      'MCP_SERVERS /graph/auth/issuer: Expected an https URL, or an http URL on a loopback address',
      'MCP_SERVERS /graph/auth: Set an Authorization header or an auth block, not both',
      'MCP_SERVERS /other/auth/issuer: Expected an https URL, or an http URL on a loopback address',
    ]);
  });
});

describe('the credential of an auth block', () => {
  it('refuses a credential that is not one of the two', () => {
    const issued = { client_id: 'brain', issuer: 'https://auth.example.com' };
    const key = { private_key: '${GRAPH_CLIENT_SECRET}' };
    const neither = 'Expected client_secret, or private_key with its algorithm, one of the two';

    expect(
      problemsOf({
        graph: { ...graph, auth: issued },
        keyed: { ...graph, auth: { ...issued, ...key, algorithm: 'RS256', client_secret: '${GRAPH_CLIENT_SECRET}' } },
        bare: { ...graph, auth: { ...issued, ...key } },
      }),
    ).toEqual([
      `MCP_SERVERS /graph/auth: ${neither}`,
      `MCP_SERVERS /keyed/auth: ${neither}`,
      `MCP_SERVERS /bare/auth: ${neither}`,
    ]);
  });
});

describe('the brains a server serves', () => {
  it('serves every brain of its org, or the brains it names', () => {
    const [everyBrain, someBrains] = settingsOf({ graph, crm: { ...graph, brains: ['sales'] } }).servers;

    expect(served(everyBrain, 'acme', 'alpha')).toBe(true);
    expect(served(everyBrain, 'globex', 'alpha')).toBe(false);
    expect(served(someBrains, 'acme', 'sales')).toBe(true);
    expect(served(someBrains, 'acme', 'alpha')).toBe(false);
  });
});
