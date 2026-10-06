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
    graph: {
      url: 'https://graph.example.com/mcp',
      org: 'acme',
      headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
    },
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
    limitless: {
      command: 'limitless-mcp-server',
      org: 'acme',
      env: { LIMITLESS_API_KEY: '${LIMITLESS_API_KEY}', MODE: 'production', HOME_DIR: '/home/brain-user' },
    },
  }),
};

function scrubbed(text: string): string {
  const { servers } = Effect.runSync(readMcpSettings(environment, { modelProviders: [] }));
  return secretsOfServers(servers).scrub(text);
}

describe('the secrets of the servers', () => {
  it('are the values of references and the credentials of auth blocks', () => {
    expect(
      scrubbed(
        'Bearer graph-api-key-4f1d9a7c2b, graph-client-secret-81c2, graph-private-key-7a6b and limitless-key-3e9d',
      ),
    ).toBe('Bearer [redacted], [redacted], [redacted] and [redacted]');
  });

  it('are never a value written out in a header or an environment', () => {
    expect(scrubbed('Deployed to production-eu with MODE=production in /home/brain-user')).toBe(
      'Deployed to production-eu with MODE=production in /home/brain-user',
    );
  });

  it('are scrubbed as they are written inside JSON too, where a quote, a backslash or a line break is escaped', () => {
    const secrets = secretsOf([]);
    const awkward = 'pa"ss\\word\nnext-line';
    secrets.add(awkward);

    expect(secrets.scrub(JSON.stringify({ said: `the key is ${awkward}` }))).toBe('{"said":"the key is [redacted]"}');
    expect(secrets.scrub(`raw ${awkward}`)).toBe('raw [redacted]');
  });

  it('are scrubbed when JSON holds them twice encoded, as the text content of a tool that is itself JSON does', () => {
    const secrets = secretsOf([]);
    const awkward = 'pa"ss\\word\nnext-line';
    secrets.add(awkward);
    const result = { content: [{ type: 'text', text: JSON.stringify({ key: awkward }) }] };

    expect(secrets.scrub(JSON.stringify(result))).toBe(
      JSON.stringify({ content: [{ type: 'text', text: '{"key":"[redacted]"}' }] }),
    );
  });

  it('take a token minted while the server runs, and leave out what is too short to be one', () => {
    const secrets = secretsOf([]);
    secrets.add('tiny');
    secrets.add('minted-token-9f3e');

    expect(secrets.scrub('Bearer minted-token-9f3e, tiny')).toBe('Bearer [redacted], tiny');
  });
});
