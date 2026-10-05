import { describe, expect, it } from 'vitest';

import { failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { catalogFor, idsIn } from '../testing/catalog-harness.ts';
import { anthropicModels, vercelGatewayModels } from '../testing/model-lists.ts';
import { anthropicMessage } from '../testing/provider-replies.ts';
import { jsonResponse, type Responder } from '../testing/recording-fetch.ts';

const answering: Responder = ({ url }) => {
  if (url.endsWith('/messages')) {
    return jsonResponse(anthropicMessage('Hello'));
  }
  return jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels);
};

function offering(allowed: readonly string[], aliases: object = {}): Readonly<Record<string, string>> {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-key',
    MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
    MODEL_ALIASES: JSON.stringify(aliases),
    ALLOWED_MODELS: JSON.stringify(allowed),
  };
}

describe('the models an operator allows', () => {
  it('are the only ones listed, by exact name or under a wildcard', async () => {
    const catalog = await catalogFor(
      offering(['anthropic/claude-sonnet-4-5-20250929', 'gateway/anthropic/*', 'house/fast']),
      answering,
    );

    expect(idsIn(await catalog.list())).toEqual([
      'anthropic/claude-sonnet-4-5-20250929',
      'gateway/anthropic/claude-haiku-4-5',
    ]);
  });

  it('show a wildcard alias only when a wildcard allows every model it stands for', async () => {
    const aliases = {
      'openai/*': 'gateway/openai/*',
      'house/fast': 'gateway/fast',
      'mistral/large-*': 'gateway/large-*',
    };
    const narrow = await catalogFor(offering(['openai/gpt-5', 'house/fast', 'mistral/*'], aliases), answering);
    const wide = await catalogFor(offering(['openai/*'], aliases), answering);

    expect(idsIn(await narrow.list())).toEqual(['house/fast', 'mistral/large-*']);
    expect(idsIn(await wide.list())).toEqual(['openai/*']);
  });
});

describe('the models a spec may name when an operator allows some', () => {
  it('are the only ones a spec may name, and another fails before anything is sent', async () => {
    const catalog = await catalogFor(
      offering(['anthropic/claude-sonnet-4-5', 'house/*'], { 'house/fast': 'anthropic/claude-haiku-4-5' }),
      answering,
    );

    const refused = await failed(catalog.access, textRequest('anthropic/claude-opus-4-1'));
    const throughAlias = await succeeded(catalog.access, textRequest('house/fast'));
    const named = await succeeded(catalog.access, textRequest('anthropic/claude-sonnet-4-5'));

    expect(refused).toMatchObject({
      _tag: 'model_not_allowed',
      detail:
        'anthropic/claude-opus-4-1 is not one of the models this server offers. Offered models: anthropic/claude-sonnet-4-5, house/*',
      provider: 'anthropic',
      offered: ['anthropic/claude-sonnet-4-5', 'house/*'],
    });
    expect([throughAlias.text, named.text]).toEqual(['Hello', 'Hello']);
    expect(catalog.requests().map(({ url, body }) => [url, body])).toMatchObject([
      ['https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5' }],
      ['https://api.anthropic.com/v1/messages', { model: 'claude-sonnet-4-5' }],
    ]);
  });

  it('are every model when there is no allow list', async () => {
    const catalog = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, answering);

    expect((await succeeded(catalog.access, textRequest('anthropic/claude-opus-4-1'))).text).toBe('Hello');
  });
});
