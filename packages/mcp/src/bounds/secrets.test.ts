import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readMcpSettings } from '../settings/settings-reading.ts';
import { secretsOf, secretsOfServers } from './secrets.ts';

const environment = {
  GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b',
  GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2',
  GRAPH_PRIVATE_KEY: 'graph-private-key-7a6b',
  LIMITLESS_API_KEY: 'limitless-key-3e9d',
  MCP_SERVERS: JSON.stringify({
    graph: { url: 'https://graph.example.com/mcp', org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
    secret: {
      url: 'https://secret.example.com/mcp',
      org: 'acme',
      auth: { issuer: 'https://auth.example.com', client_id: 'brain', client_secret: '${GRAPH_CLIENT_SECRET}' },
    },
    keyed: {
      url: 'https://keyed.example.com/mcp',
      org: 'acme',
      auth: {
        issuer: 'https://auth.example.com',
        client_id: 'brain',
        private_key: '${GRAPH_PRIVATE_KEY}',
        algorithm: 'RS256',
      },
    },
    limitless: { command: 'limitless-mcp-server', org: 'acme', env: { LIMITLESS_API_KEY: '${LIMITLESS_API_KEY}' } },
  }),
};

describe('the secrets of the servers', () => {
  it('scrubs every header, client secret, private key and environment value, and each word of one', () => {
    const { servers } = Effect.runSync(readMcpSettings(environment, { modelProviders: [] }));
    const { scrub } = secretsOfServers(servers);

    expect(
      scrub(
        'Bearer graph-api-key-4f1d9a7c2b graph-client-secret-81c2 graph-private-key-7a6b limitless-key-3e9d graph-api-key-4f1d9a7c2b',
      ),
    ).toBe('[redacted] [redacted] [redacted] [redacted] [redacted]');
  });

  it('scrubs a token minted while the server runs, and ignores words too short to be secrets', () => {
    const secrets = secretsOf([]);
    secrets.add('token-1 tiny');

    expect(secrets.scrub('token-1 tiny')).toBe('[redacted]');
    secrets.add('minted-token-9f3e');
    expect(secrets.scrub('Bearer minted-token-9f3e, tiny')).toBe('Bearer [redacted], tiny');
  });
});
