import { makeDispatcher, type CallerIdentity, type Outcome } from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter } from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { catalogFor } from '../testing/catalog-harness.ts';
import { anthropicModels, vercelGatewayModels } from '../testing/model-lists.ts';
import { jsonResponse } from '../testing/recording-fetch.ts';
import { defineListModels } from './list-models.ts';

const reader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' };

const writerOnly: CallerIdentity = { id: 'acme-writer', org: 'acme', permissions: ['brain:write'], brains: '*' };

const environment = {
  ANTHROPIC_API_KEY: 'sk-ant-key',
  MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
  MODEL_ALIASES: JSON.stringify({ 'house/fast': 'gateway/anthropic/claude-haiku-4-5' }),
};

const services = Layer.mergeAll(memoryLedger().layer, memoryBrainRegistry([]), recordingReporter().layer);

function outputOf(outcome: Outcome): unknown {
  return outcome.status === 'succeeded' ? outcome.output : undefined;
}

async function listModels(input: unknown, caller: CallerIdentity = reader) {
  const catalog = await catalogFor(environment, ({ url }) =>
    jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels),
  );
  const { registration } = defineListModels(catalog.access.catalog);
  const outcome: Outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
      .pipe(Effect.provide(services)),
  );
  return { registration, outcome };
}

describe('list_models', () => {
  it('is a query of the org at GET /models that anyone who may read the org can call', async () => {
    const { registration, outcome } = await listModels({});

    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_models',
      route: { method: 'GET', path: '/models' },
      reachesOutside: true,
    });
    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { object: 'list', catalog_status: 'complete' },
    });
  });
});

describe('the answer of list_models', () => {
  it('answers in the shape of the list of models of the OpenAI API', async () => {
    const { outcome } = await listModels({ provider: 'gateway' });

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        object: 'list',
        data: [
          {
            id: 'gateway/alibaba/qwen-3-14b',
            object: 'model',
            created: 1_755_815_280,
            owned_by: 'gateway',
            name: 'Qwen3-14B',
            context_window: 40_960,
            max_tokens: 16_384,
          },
          {
            id: 'gateway/anthropic/claude-haiku-4-5',
            object: 'model',
            created: 1_760_486_400,
            owned_by: 'gateway',
            name: 'Claude Haiku 4.5',
            context_window: 200_000,
            max_tokens: 64_000,
          },
          {
            id: 'house/fast',
            object: 'model',
            created: 0,
            owned_by: 'gateway',
            resolved_to: 'gateway/anthropic/claude-haiku-4-5',
          },
        ],
        catalog_status: 'complete',
      },
    });
  });
});

describe('the plain words of list_models', () => {
  it('says in plain words what it found and what it tried to do', async () => {
    const { registration, outcome } = await listModels({});
    const words = registration.plainLanguage;

    expect(words?.outcome(outputOf(outcome), {})).toBe(
      'This server can call 6 models through anthropic and gateway: Claude Haiku 4.5, Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5, and fast.',
    );
    expect(words?.attempt({})).toBe('list the models this server can call');
    expect(words?.attempt({ provider: 'gateway' })).toBe('list the models this server can call through gateway');
    expect(words?.attempt({ provider: 'Not A Provider' })).toBe('list the models this server can call');
  });

  it('rejects a provider that is not written as a provider prefix, and a caller who may not read the org', async () => {
    expect((await listModels({ provider: 'Gateway/' })).outcome).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/provider' }],
    });
    expect((await listModels({}, writerOnly)).outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('the description of list_models', () => {
  it('says what each field of the answer means', async () => {
    const { registration } = await listModels({});

    expect(registration.description).toBe(
      [
        'Lists the models this server can call, in the shape of the list of models of the OpenAI API, so a spec can name one that works.',
        'Each entry has the id a spec gives as its model (provider/model id), object model, created (seconds since 1970, 0 when the provider does not say),',
        'owned_by (the provider prefix that serves it) and, when the provider reports them, name, context_window and max_tokens.',
        'An alias its operator set is listed by its own name, with resolved_to naming the model it is sent to;',
        'an entry whose id ends in * has pattern true and stands for any model id in place of the *.',
        'Lists are read from the providers with the credentials of this server and kept for five minutes;',
        'catalog_status is partial when a provider could not be asked, so its models are missing or as they were last read,',
        'and listed_at says when the oldest list was read.',
      ].join(' '),
    );
  });
});
