import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readEntry, readToolServerSettings } from '../index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

describe('the secrets of an entry', () => {
  it('hold the credential after its scheme too, when a referenced variable holds a header whole', () => {
    const environment = {
      TOOL_SERVERS: JSON.stringify({ graph: { ...graph, headers: { Authorization: '${HEADER}' } } }),
    };

    const { servers } = Effect.runSync(readToolServerSettings({ ...environment, HEADER: `Bearer ${apiKey}` }, context));

    expect(servers[0]?.secrets.map((secret) => Redacted.value(secret))).toEqual([`Bearer ${apiKey}`, apiKey]);
  });

  it('are read from one entry as from the settings file, given the variables it refers to', () => {
    const read = readEntry('graph', { ...graph, headers: { 'X-Api-Key': '${KEY}' } }, { KEY: apiKey }, context);

    expect(read).toMatchObject({ _tag: 'Success', success: { name: 'graph', type: 'mcp' } });
  });
});
