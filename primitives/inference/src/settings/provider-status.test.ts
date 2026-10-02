import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readModelSettings } from './model-settings.ts';
import { providerStatus } from './provider-status.ts';
import type { Environment } from './setting-values.ts';

function statusOf(environment: Environment, entraId: boolean) {
  return Effect.runPromise(readModelSettings(environment)).then((settings) => providerStatus(settings, { entraId }));
}

const everything = {
  ANTHROPIC_API_KEY: 'a',
  OPENAI_API_KEY: 'o',
  GOOGLE_GENERATIVE_AI_API_KEY: 'g',
  AWS_REGION: 'us-east-1',
  AZURE_RESOURCE_NAME: 'acme',
  AZURE_API_KEY: 'z',
  GOOGLE_VERTEX_PROJECT: 'p',
  GOOGLE_VERTEX_LOCATION: 'us-central1',
  MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal/v1' }]),
};

describe('providerStatus', () => {
  it('lists every configured provider, the gateways last', async () => {
    const status = await statusOf(everything, false);

    expect(status).toEqual({
      configured: [
        'anthropic',
        'openai',
        'google',
        'bedrock',
        'bedrock-anthropic',
        'azure',
        'vertex',
        'vertex-anthropic',
        'internal',
      ],
      unconfigured: [],
    });
  });
});

describe('providerStatus of unconfigured providers', () => {
  it('names the settings each unconfigured provider lacks', async () => {
    const status = await statusOf({ GOOGLE_VERTEX_PROJECT: 'p' }, false);

    expect(status.configured).toEqual([]);
    expect(status.unconfigured).toEqual([
      { provider: 'anthropic', missing: ['ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'] },
      { provider: 'openai', missing: ['OPENAI_API_KEY'] },
      { provider: 'google', missing: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
      { provider: 'bedrock', missing: ['AWS_REGION'] },
      { provider: 'bedrock-anthropic', missing: ['AWS_REGION'] },
      { provider: 'azure', missing: ['AZURE_RESOURCE_NAME or AZURE_BASE_URL'] },
      { provider: 'vertex', missing: ['GOOGLE_VERTEX_LOCATION'] },
      { provider: 'vertex-anthropic', missing: ['GOOGLE_VERTEX_LOCATION'] },
    ]);
  });

  it('configures azure without a key only when Microsoft Entra ID is available', async () => {
    const withEntra = await statusOf({ AZURE_RESOURCE_NAME: 'acme' }, true);
    const withoutEntra = await statusOf({ AZURE_RESOURCE_NAME: 'acme' }, false);

    expect(withEntra.configured).toEqual(['azure']);
    expect(withoutEntra.unconfigured).toContainEqual({
      provider: 'azure',
      missing: ['AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID'],
    });
  });
});
